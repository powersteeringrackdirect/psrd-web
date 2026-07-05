/**
 * psrd-sync — Cloudflare Worker
 *
 * Keeps CF KV populated with live GHL product data.
 * Two triggers:
 *   1. POST /stripe-webhook  — fires instantly on every purchase
 *   2. Cron 03:00 UTC daily  — backup full sync
 *
 * Security: every Stripe webhook is verified with HMAC-SHA256.
 * No unverified request can trigger a sync.
 */

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ─── Stripe HMAC-SHA256 signature verification ────────────────────────────
async function verifyStripeSignature(body, sigHeader, secret) {
  const parts     = sigHeader.split(',');
  const timestamp = parts.find(p => p.startsWith('t='))?.slice(2);
  const signature = parts.find(p => p.startsWith('v1='))?.slice(3);
  if (!timestamp || !signature) return false;
  const payload   = `${timestamp}.${body}`;
  const key       = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  const hex = Array.from(new Uint8Array(mac)).map(b => b.toString(16).padStart(2,'0')).join('');
  return hex === signature;
}

// ─── GHL HTML Parsers ───────────────────────────────────────────────────────
function decodeEntities(s) {
  return String(s??'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&ndash;/g,'\u2013')
    .replace(/&mdash;/g,'\u2014').replace(/&nbsp;/g,' ');
}

function extractChips(html) {
  const chips=[];const re=/<span[^>]+class="chip[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/gi;let m;
  while((m=re.exec(html))!==null) chips.push(m[1].trim());
  return chips;
}

function parseYears(raw) {
  const s=decodeEntities(raw);
  if(s.includes('\u2013')){const[f,t]=s.split('\u2013');return{yearFrom:(f||'').trim(),yearTo:(t||'').trim()};}
  return{yearFrom:s.trim(),yearTo:''};
}

function parseDescription(html) {
  const out={mpn:'',brand:'',collectionSlug:'',condition:'',drive:'RHD',warrantyMonths:null,
    modules:[],crossRefs:[],fitments:[],intro:'',badgesHtml:''};
  if(!html)return out;
  const collM=/href="[^"]*\/products-list\/collections\/([^\/"]+)"[^>]*>([^<]+)<\/a>/i.exec(html);
  if(collM){out.collectionSlug=collM[1].trim();out.brand=collM[2].trim();}
  const badgesM=/<div class="badges">((?:[^<]|<(?!\/div>))*?)<\/div>/i.exec(html);
  if(badgesM)out.badgesHtml=badgesM[1].trim();
  const condM=/class="[^"]*\bb-condition\b[^"]*"[^>]*>([^<]+)<\/span>/i.exec(html);
  if(condM)out.condition=condM[1].toLowerCase().includes('new')?'Brand New':'Pre-owned';
  const drvM=/class="[^"]*\bb-drv\b[^"]*"[^>]*>([^<]+)<\/span>/i.exec(html);
  if(drvM)out.drive=drvM[1].trim().toUpperCase();
  const warM=/class="[^"]*\bb-war\b[^"]*"[^>]*>(\d+)[^<]*<\/span>/i.exec(html);
  if(warM)out.warrantyMonths=parseInt(warM[1],10);
  const pairRe=/<div class="pn-lbl">([^<]+)<\/div>\s*<div class="chips">((?:[^<]|<(?!\/div>))*?)<\/div>/gi;
  let pair;
  while((pair=pairRe.exec(html))!==null){
    const label=pair[1].trim();const ch=pair[2];
    if(label==='Part number (MPN)'){const m=/<span[^>]+class="[^"]*\bmpn\b[^"]*"[^>]*>([^<]+)<\/span>/i.exec(ch);if(m)out.mpn=m[1].trim();}
    else if(/electronic module/i.test(label))out.modules=extractChips(ch);
    else if(/oem cross-ref/i.test(label))out.crossRefs=extractChips(ch);
  }
  const introM=/<p[^>]+class="[^"]*\bintro\b[^"]*"[^>]*>([\s\S]*?)<\/p>/i.exec(html);
  if(introM)out.intro=decodeEntities(introM[1].replace(/<[^>]+>/g,'').trim());
  const tbodyM=/<table[^>]+class="[^"]*\bct\b[^"]*"[^>]*>[\s\S]*?<tbody>([\s\S]*?)<\/tbody>/i.exec(html);
  if(tbodyM){
    const rowRe=/<tr>([\s\S]*?)<\/tr>/gi;let row;
    while((row=rowRe.exec(tbodyM[1]))!==null){
      const tds=[];const tdRe=/<td[^>]*>([\s\S]*?)<\/td>/gi;let td;
      while((td=tdRe.exec(row[1]))!==null){tds.push(decodeEntities(td[1].replace(/<[^>]+>/g,'').trim()));if(tds.length===5)break;}
      if(tds.length<3)continue;
      const[make,model,chassis,yearsRaw='',driveCell='']=tds;
      const{yearFrom,yearTo}=parseYears(yearsRaw);
      out.fitments.push({make,model,chassis,yearFrom,yearTo,drive:driveCell.trim().toUpperCase()});
    }
  }
  return out;
}

// ─── GHL API ─────────────────────────────────────────────────────────────────
async function fetchAllProducts(env) {
  const all=[];let offset=0;
  while(true){
    const res=await fetch(`${env.GHL_WORKER}/products/?locationId=${env.GHL_LOC}&limit=100&offset=${offset}`);
    if(!res.ok)throw new Error(`Batch HTTP ${res.status}`);
    const data=await res.json();const batch=data.products||[];
    all.push(...batch);
    if(batch.length<100)break;
    offset+=100;
  }
  return all;
}

async function fetchDetail(id, env) {
  try{
    const res=await fetch(`${env.GHL_WORKER}/products/${id}?locationId=${env.GHL_LOC}`);
    if(!res.ok)return null;
    const raw=await res.json();return raw.product||raw;
  }catch{return null;}
}

async function fetchPrice(id, env) {
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const res=await fetch(`${env.GHL_WORKER}/products/${id}/price?locationId=${env.GHL_LOC}`);
      if(!res.ok){await sleep(400*attempt);continue;}
      const data=await res.json();
      const prices=data?.prices||[];
      if(prices.length>0&&prices[0].amount!=null)return data;
      if(attempt<3)await sleep(400*attempt);
    }catch{if(attempt<3)await sleep(400*attempt);}
  }
  return null;
}

// ─── Build the KV entry for a product ─────────────────────────────────────────
// This is stored in KV and read by functions/product-details/product/[slug].js
function buildEntry(batch, detail, priceData) {
  const p      = detail||batch;
  const prices = priceData?.prices||[];
  const price0 = prices[0]??null;
  const amount   = price0?.amount??0;
  const sku      = price0?.sku||'';
  const currency = price0?.currency||'GBP';
  const availQty = price0?.availableQuantity??null;
  const noStock  = price0?.allowOutOfStockPurchases??true;
  const inStock  = availQty!==null?(availQty>0||noStock):(p.availableInStore!==false);

  const images=[];
  if(Array.isArray(p.medias)&&p.medias.length>0){
    const feat=p.medias.filter(m=>m.isFeatured&&m.url);
    const rest=p.medias.filter(m=>!m.isFeatured&&m.url);
    for(const m of[...feat,...rest])if(!images.some(i=>i.url===m.url))images.push({url:m.url,title:m.title||''});
  }
  if(p.image&&!images.some(i=>i.url===p.image))images.push({url:p.image,title:''});

  const parsed=parseDescription(p.description||'');

  let mpn=parsed.mpn;
  if(!mpn&&p.name){
    const words=p.name.split(/[\s()]+/);
    for(let i=words.length-1;i>=0;i--){
      const w=words[i];
      if(w.length>=6&&/[A-Za-z]/.test(w)&&/[0-9]/.test(w)&&!['RHD','LHD','USED','NEW','REMAN','EPS','OEM'].includes(w.toUpperCase())){mpn=w;break;}
    }
  }

  let condition='Pre-owned';
  if(sku){const s=sku.toUpperCase();if(s.includes('-NEW'))condition='Brand New';else if(s.includes('-USED'))condition='Pre-owned';}
  else if(p.isLabelEnabled&&p.label?.title==='New')condition='Brand New';
  else if(parsed.condition)condition=parsed.condition;

  const warrantyMonths=parsed.warrantyMonths??(condition==='Brand New'?12:6);

  return {
    id:            p._id||p.id||'',
    slug:          p.slug||'',
    name:          p.name||'',
    sku, mpn,
    brand:         parsed.brand||'',
    collectionSlug:parsed.collectionSlug||'',
    currency,
    price:         amount.toString(),
    inStock,
    condition,
    warrantyMonths,
    drive:         parsed.drive||'RHD',
    images,
    modules:       parsed.modules,
    crossRefs:     parsed.crossRefs,
    fitments:      parsed.fitments,
    intro:         parsed.intro,            // full text, not truncated
    availability:  inStock?'https://schema.org/InStock':'https://schema.org/OutOfStock',
    itemCondition: condition==='Brand New'?'https://schema.org/NewCondition':'https://schema.org/UsedCondition',
    syncedAt:      new Date().toISOString(),
  };
}

// ─── Sync a single product into KV ───────────────────────────────────────────
async function syncOne(productId, env) {
  const[detail,priceData]=await Promise.all([fetchDetail(productId,env),fetchPrice(productId,env)]);
  if(!detail?.slug)return;
  const entry=buildEntry(detail,detail,priceData);
  await env.PRODUCTS.put(`product:${detail.slug}`,JSON.stringify(entry));
  console.log(`[sync] ✅ ${detail.slug} — ${entry.availability}`);
}

// ─── Full sync (all products) ────────────────────────────────────────────────
async function syncAll(env) {
  console.log('[sync] Starting full sync...');
  const batch=await fetchAllProducts(env);
  const slugs=[];let synced=0,errors=0;
  const CONCURRENCY=5;let idx=0;
  async function worker(){
    while(idx<batch.length){
      const bp=batch[idx++];
      try{
        if(!bp.slug){errors++;continue;}
        const[detail,priceData]=await Promise.all([fetchDetail(bp._id,env),fetchPrice(bp._id,env)]);
        const entry=buildEntry(bp,detail,priceData);
        await env.PRODUCTS.put(`product:${bp.slug}`,JSON.stringify(entry));
        slugs.push(bp.slug);synced++;
      }catch(err){console.error(`[sync] ❌ ${bp._id}: ${err.message}`);errors++;}
    }
  }
  await Promise.all(Array.from({length:CONCURRENCY},worker));
  await env.PRODUCTS.put('all:slugs',JSON.stringify(slugs));
  console.log(`[sync] Done. Synced: ${synced}, Errors: ${errors}`);
  return{synced,errors};
}

// ─── Main ────────────────────────────────────────────────────────────────────
export default {
  async fetch(request, env) {
    const url=new URL(request.url);

    // ── Stripe webhook ──────────────────────────────────────────────────
    if(request.method==='POST'&&url.pathname==='/stripe-webhook'){
      const body  =await request.text();
      const sigHdr=request.headers.get('stripe-signature')||'';
      const valid =await verifyStripeSignature(body,sigHdr,env.STRIPE_WEBHOOK_SECRET);
      if(!valid)return new Response('Unauthorized',{status:401});

      let event;
      try{event=JSON.parse(body);}catch{return new Response('Bad JSON',{status:400});}

      if(event.type==='payment_intent.succeeded'){
        const meta=event.data?.object?.metadata||{};
        const ghlId=meta.ghl_product_id||meta.productId;
        // Sync the specific sold product, or fall back to full sync
        if(ghlId)await syncOne(ghlId,env);
        else await syncAll(env);
      }
      return new Response('OK',{status:200});
    }

    // ── Manual trigger ──────────────────────────────────────────────────
    if(request.method==='GET'&&url.pathname==='/sync'){
      const result=await syncAll(env);
      return new Response(JSON.stringify(result),{headers:{'Content-Type':'application/json'}});
    }

    return new Response('psrd-sync worker. Use /sync to trigger manually.',{status:200});
  },

  // Daily backup cron at 03:00 UTC
  async scheduled(event, env, ctx){
    ctx.waitUntil(syncAll(env));
  },
};
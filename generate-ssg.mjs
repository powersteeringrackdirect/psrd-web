/**
 * generate-ssg.mjs — simplified
 *
 * Generates only:
 *   - Static route pages (/, /about, /contact, etc.)
 *   - Brand collection pages (/products-list/collections/*)
 *   - sitemap.xml (includes product URLs for crawlers)
 *   - robots.txt
 *   - 404.html
 *
 * Product pages are rendered live by CF Pages Function from KV.
 * Do NOT run this for stock changes — psrd-sync handles that automatically.
 *
 * Run this when:
 *   - A static page title/description changes
 *   - A new product slug appears (updates sitemap)
 *   - template.html changes (Vite rebuild)
 */

import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WORKER   = 'https://muddy-cloud-75ed.mike-83d.workers.dev';
const LOC      = '2SnelkrGrY0pBrSw0nUF';
const SITE     = 'https://powersteeringrackdirect.com';
const DIST     = path.join(__dirname, 'dist');
const TEMPLATE = path.join(__dirname, 'template.html');
const LOGO     = 'https://assets.cdn.filesafe.space/2SnelkrGrY0pBrSw0nUF/media/6a173ed65be84ad6400be408.webp';

function preflight() {
  if(!fs.existsSync(TEMPLATE)){console.error('\u274c template.html not found');process.exit(1);}
  if(!fs.existsSync(DIST)){console.error('\u274c dist/ not found. Create it and add assets/ first.');process.exit(1);}
  if(!fs.existsSync(path.join(DIST,'assets'))||!fs.readdirSync(path.join(DIST,'assets')).length){
    console.error('\u274c dist/assets/ empty. Copy assets/ into dist/assets/ first.');process.exit(1);
  }
}

function esc(str){
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const cleanTemplate = html => html
  .replace(/<title>[\s\S]*?<\/title>/gi,'')
  .replace(/<link[^>]+rel="canonical"[^>]*\/?>/gi,'')
  .replace(/<link[^>]+rel="alternate"[^>]*\/?>/gi,'')
  .replace(/<meta[^>]+name="description"[^>]*\/?>/gi,'')
  .replace(/<meta[^>]+name="robots"[^>]*\/?>/gi,'')
  .replace(/<meta[^>]+name="googlebot"[^>]*\/?>/gi,'')
  .replace(/<meta[^>]+property="og:[^"]*"[^>]*\/?>/gi,'')
  .replace(/<meta[^>]+name="twitter:[^"]*"[^>]*\/?>/gi,'')
  .replace(/<script[^>]+type="application\/ld\+json"[^>]*>[\s\S]*?<\/script>/gi,'');

function buildSiteNodes(){
  return [
    {'@type':'WebSite','@id':`${SITE}#website`,url:SITE,name:'Power Steering Rack Direct',
      potentialAction:{'@type':'SearchAction',target:{'@type':'EntryPoint',urlTemplate:`${SITE}/products-list?q={search_term_string}`},'query-input':'required name=search_term_string'}},
    {'@type':'OnlineStore','@id':`${SITE}#store`,name:'Power Steering Rack Direct',url:SITE,
      telephone:'+44 7456 373490',image:LOGO,
      address:{'@type':'PostalAddress',streetAddress:'15 Fort Road, Halstead',addressLocality:'Sevenoaks',addressRegion:'Kent',postalCode:'TN14 7BW',addressCountry:'GB'}},
    {'@type':'MerchantReturnPolicy','@id':`${SITE}#rp-gb`,applicableCountry:'GB',
      returnPolicyCategory:'https://schema.org/MerchantReturnFiniteReturnWindow',merchantReturnDays:14,
      returnMethod:'https://schema.org/ReturnByMail',returnFees:'https://schema.org/ReturnShippingFees',merchantReturnLink:`${SITE}/returns`},
  ];
}

function buildPageSchema(route, url){
  const graph=[...buildSiteNodes()];
  if(route.collectionSlug){
    graph.push({'@type':'BreadcrumbList','@id':`${url}#breadcrumb`,itemListElement:[{'@type':'ListItem',position:1,name:'Power Steering Rack Direct',item:SITE},{'@type':'ListItem',position:2,name:route.brandName,item:url}]});
    graph.push({'@type':'CollectionPage','@id':`${url}#collection`,name:`${route.brandName} Power Steering Racks`,url,breadcrumb:{'@id':`${url}#breadcrumb`},isPartOf:{'@id':`${SITE}#website`}});
  }else if(route.path!=='/'){
    graph.push({'@type':'BreadcrumbList','@id':`${url}#breadcrumb`,itemListElement:[{'@type':'ListItem',position:1,name:'Power Steering Rack Direct',item:SITE},{'@type':'ListItem',position:2,name:route.title.split('\u2014')[0].trim(),item:url}]});
  }
  return{'@context':'https://schema.org','@graph':graph};
}

function buildHeadBlock({title,description,canonical,ogImage,ogType='website',schema,noindex=false}){
  const robots=noindex?'noindex,nofollow':'index,follow,max-image-preview:large';
  return [
    `<title>${esc(title)}</title>`,
    `<link rel="canonical" href="${esc(canonical)}">`,
    `<link rel="alternate" hreflang="en-gb"    href="${esc(canonical)}">`,
    `<link rel="alternate" hreflang="x-default" href="${esc(canonical)}">`,
    `<meta name="description" content="${esc(description)}">`,
    `<meta name="robots"    content="${robots}">`,
    `<meta name="googlebot" content="${robots}">`,
    `<meta property="og:title"       content="${esc(title)}">`,
    `<meta property="og:description" content="${esc(description)}">`,
    `<meta property="og:type"        content="${ogType}">`,
    `<meta property="og:url"         content="${esc(canonical)}">`,
    ogImage?`<meta property="og:image" content="${esc(ogImage)}">` : '',
    `<meta name="twitter:card"        content="summary_large_image">`,
    `<meta name="twitter:title"       content="${esc(title)}">`,
    `<meta name="twitter:description" content="${esc(description)}">`,
    ogImage?`<meta name="twitter:image" content="${esc(ogImage)}">` : '',
    schema?`<script type="application/ld+json">${JSON.stringify(schema)}</script>`:'',
  ].filter(Boolean).join('\n    ');
}

function writeHtml(routePath, html){
  const dir=path.join(DIST,routePath==='/'?'':routePath);
  fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'index.html'),html,'utf-8');
}

async function fetchSlugs(){
  const all=[];let offset=0;
  while(true){
    const res=await fetch(`${WORKER}/products/?locationId=${LOC}&limit=100&offset=${offset}`);
    if(!res.ok)throw new Error(`Slugs fetch HTTP ${res.status}`);
    const data=await res.json();const batch=data.products||[];
    all.push(...batch.filter(p=>p.slug).map(p=>p.slug));
    if(batch.length<100)break;
    offset+=100;
  }
  return all;
}

const STATIC_ROUTES = [
  {path:'/',title:'Power Steering Rack Direct \u2014 OEM Power Steering Racks',
    desc:'Shop brand new and pre-owned, fully tested OEM Power Steering Racks at competitive pricing. Fast global shipping and expert support.',
    changefreq:'daily',priority:'1.0'},
  {path:'/products-list',title:'OEM Power Steering Racks \u2014 Browse by Make & Model | Power Steering Rack Direct',
    desc:'DYNAMIC',changefreq:'weekly',priority:'0.8'},
  {path:'/about',          title:'About Us \u2014 Power Steering Rack Direct',          desc:'UK specialists in OEM power steering racks, EPS system coding, and steering component supply for European vehicles.'},
  {path:'/contact',        title:'Contact Us \u2014 Power Steering Rack Direct',        desc:'Get in touch for part queries, technical support, EPS coding help or shipping information.'},
  {path:'/faq',            title:'FAQ \u2014 Power Steering Rack Direct',               desc:'Frequently asked questions about OEM power steering racks, fitment, EPS coding, shipping and returns.'},
  {path:'/b2b',            title:'B2B Trade Enquiries \u2014 Power Steering Rack Direct',desc:'Wholesale and trade pricing for garages, dealerships and parts suppliers. Contact us for B2B terms.'},
  {path:'/info-hub',       title:'Info Hub \u2014 Power Steering Rack Direct',          desc:'Technical guides, EPS coding information and fitment resources for power steering rack replacement.'},
  {path:'/warranty',       title:'Warranty Policy \u2014 Power Steering Rack Direct',   desc:'New units: 12-month warranty. Pre-owned units: 6-month warranty from date of purchase.'},
  {path:'/terms',          title:'Terms & Conditions \u2014 Power Steering Rack Direct',desc:'Terms and conditions for purchasing from Power Steering Rack Direct.'},
  {path:'/privacy-policy', title:'Privacy Policy \u2014 Power Steering Rack Direct',    desc:'How Power Steering Rack Direct collects, uses and protects your personal data.'},
  {path:'/shipping',       title:'Shipping & Delivery \u2014 Power Steering Rack Direct',desc:'UK from \u00a349, Europe from \u00a359, Worldwide from \u00a3159. Fast dispatch 1\u20132 business days.'},
  {path:'/returns',        title:'Returns Policy \u2014 Power Steering Rack Direct',    desc:'Returns accepted within 14 days. Items must be in original condition. Return shipping at buyer\u2019s expense.'},
];

const COLLECTIONS = [
  {slug:'audi',brandName:'Audi'},{slug:'bmw',brandName:'BMW'},
  {slug:'mercedes',brandName:'Mercedes-Benz'},{slug:'volkswagen',brandName:'Volkswagen'},
  {slug:'porsche',brandName:'Porsche'},{slug:'land-rover',brandName:'Land Rover'},
  {slug:'seat',brandName:'SEAT'},{slug:'skoda',brandName:'\u0160koda'},
  {slug:'ford',brandName:'Ford'},{slug:'maserati',brandName:'Maserati'},
  {slug:'volvo',brandName:'Volvo'},{slug:'fiat',brandName:'Fiat'},
  {slug:'renault',brandName:'Renault'},{slug:'hyundai',brandName:'Hyundai'},
  {slug:'bentley',brandName:'Bentley'},{slug:'maybach',brandName:'Maybach'},
];

async function run(){
  console.log('\n'+'━'.repeat(60));
  console.log('  PSRD SSG — static + collection pages');
  console.log('━'.repeat(60)+'\n');

  preflight();

  const template=cleanTemplate(fs.readFileSync(TEMPLATE,'utf-8'));
  console.log('\u2705 template.html loaded');

  console.log('\n📦 Fetching product slugs for sitemap...');
  const slugs=await fetchSlugs();
  console.log(`   ${slugs.length} slugs found.`);

  // Update /products-list with live count
  const plRoute=STATIC_ROUTES.find(r=>r.path==='/products-list');
  if(plRoute)plRoute.desc=`Browse ${slugs.length}+ OEM electric power steering racks for Audi, BMW, Mercedes-Benz, VW, Porsche, Land Rover and more. New and pre-owned, fully tested.`;

  const lastmod=new Date().toISOString().slice(0,10);
  const entry=(loc,freq,pri)=>`  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>${pri}</priority>\n  </url>`;

  // Static pages
  console.log('\n📝 Writing static pages...');
  for(const route of STATIC_ROUTES){
    const canonical=`${SITE}${route.path==='/'?'':route.path}`;
    writeHtml(route.path,template.replace('</head>',`    ${buildHeadBlock({title:route.title,description:route.desc,canonical,ogImage:LOGO,schema:buildPageSchema(route,canonical)})}\n  </head>`));
  }
  console.log(`   ${STATIC_ROUTES.length} written.`);

  // Collection pages
  console.log('\n🏷  Writing collection pages...');
  for(const col of COLLECTIONS){
    const canonical=`${SITE}/products-list/collections/${col.slug}`;
    writeHtml(`/products-list/collections/${col.slug}`,template.replace('</head>',`    ${buildHeadBlock({
      title:`${col.brandName} OEM Power Steering Racks | Power Steering Rack Direct`,
      description:`Shop OEM ${col.brandName} power steering racks \u2014 new and pre-owned, fully tested. RHD and LHD. Fast UK and EU dispatch.`,
      canonical,ogImage:LOGO,
      schema:buildPageSchema({path:canonical,collectionSlug:col.slug,brandName:col.brandName},canonical),
    })}\n  </head>`));
  }
  console.log(`   ${COLLECTIONS.length} written.`);

  // 404
  fs.writeFileSync(path.join(DIST,'404.html'),template.replace('</head>',
    `    ${buildHeadBlock({title:'404 \u2014 Not Found | Power Steering Rack Direct',
      description:'The page could not be found. Browse our OEM power steering rack catalogue.',
      canonical:`${SITE}/404`,ogImage:LOGO,noindex:true})}\n  </head>`
  ),'utf-8');

  // Sitemap
  const sitemapRows=[
    ...STATIC_ROUTES.map(r=>entry(`${SITE}${r.path==='/'?'':r.path}`,r.changefreq||(r.path==='/'?'daily':'monthly'),r.priority||(r.path==='/'?'1.0':'0.6'))),
    ...COLLECTIONS.map(c=>entry(`${SITE}/products-list/collections/${c.slug}`,'weekly','0.8')),
    ...slugs.map(s=>entry(`${SITE}/product-details/product/${s}`,'weekly','0.7')),
  ];
  fs.writeFileSync(path.join(DIST,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapRows.join('\n')}\n</urlset>`,'utf-8');

  // Robots
  fs.writeFileSync(path.join(DIST,'robots.txt'),[
    'User-agent: *','Allow: /','',
    '# GHL + Stripe session pages',
    'Disallow: /cart','Disallow: /checkout','Disallow: /thank-you','Disallow: /order-confirmation','',
    '# Customer account pages',
    'Disallow: /customer-portal','Disallow: /account','Disallow: /orders','',
    `Sitemap: ${SITE}/sitemap.xml`,
  ].join('\n'),'utf-8');

  const total=STATIC_ROUTES.length+COLLECTIONS.length+slugs.length;
  console.log(`\n\u2705 Done. Static: ${STATIC_ROUTES.length} | Collections: ${COLLECTIONS.length} | Sitemap: ${total} URLs`);
  console.log('   Product pages: served live by CF Pages Function from KV.\n');
}

run().catch(err=>{console.error('\n\u274c FAILED:',err.message);process.exit(1);});
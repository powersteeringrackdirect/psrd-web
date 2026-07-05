/**
 * CF Pages Function — /product-details/product/[slug]
 *
 * Every request to a product URL:
 *   1. Reads live product data from CF KV (kept current by psrd-sync worker)
 *   2. Fetches template.html from static assets
 *   3. Renders complete HTML with accurate JSON-LD
 *   4. Returns it to the browser / Googlebot
 *
 * Result: Google and GMC always see real-time availability and price.
 * No rebuild needed when stock changes.
 *
 * CF Pages dashboard settings required:
 *   KV namespace binding: PRODUCTS → your PSRD_PRODUCTS namespace
 */

const SITE = 'https://powersteeringrackdirect.com';
const LOGO = 'https://assets.cdn.filesafe.space/2SnelkrGrY0pBrSw0nUF/media/6a173ed65be84ad6400be408.webp';

function esc(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function truncateWords(str, max=155) {
  if(!str||str.length<=max)return str||'';
  const cut=str.slice(0,max);
  return(cut.replace(/\s+\S*$/,'')||cut)+'\u2026';
}

function buildSiteNodes() {
  return [
    {'@type':'WebSite','@id':`${SITE}#website`,url:SITE,name:'Power Steering Rack Direct',
      potentialAction:{'@type':'SearchAction',target:{'@type':'EntryPoint',urlTemplate:`${SITE}/products-list?q={search_term_string}`},'query-input':'required name=search_term_string'}},
    {'@type':'OnlineStore','@id':`${SITE}#store`,name:'Power Steering Rack Direct',url:SITE,
      telephone:'+44 7456 373490',image:LOGO,
      address:{'@type':'PostalAddress',streetAddress:'15 Fort Road, Halstead',addressLocality:'Sevenoaks',addressRegion:'Kent',postalCode:'TN14 7BW',addressCountry:'GB'}},
    {'@type':'MerchantReturnPolicy','@id':`${SITE}#rp-gb`,applicableCountry:'GB',
      returnPolicyCategory:'https://schema.org/MerchantReturnFiniteReturnWindow',merchantReturnDays:14,
      returnMethod:'https://schema.org/ReturnByMail',returnFees:'https://schema.org/ReturnShippingFees',merchantReturnLink:`${SITE}/returns`},
    {'@type':'MerchantReturnPolicy','@id':`${SITE}#rp-eu`,
      applicableCountry:['IE','FR','DE','ES','IT','NL','BE','AT','PT','PL','SE','DK','FI'],
      returnPolicyCategory:'https://schema.org/MerchantReturnFiniteReturnWindow',merchantReturnDays:14,
      returnMethod:'https://schema.org/ReturnByMail',returnFees:'https://schema.org/ReturnShippingFees',merchantReturnLink:`${SITE}/returns`},
    {'@type':'MerchantReturnPolicy','@id':`${SITE}#rp-ww`,applicableCountry:['US','CA','AU','NZ'],
      returnPolicyCategory:'https://schema.org/MerchantReturnFiniteReturnWindow',merchantReturnDays:14,
      returnMethod:'https://schema.org/ReturnByMail',returnFees:'https://schema.org/ReturnShippingFees',merchantReturnLink:`${SITE}/returns`},
    {'@type':'OfferShippingDetails','@id':`${SITE}#ship-uk`,shippingSettingsLink:`${SITE}/shipping`,url:`${SITE}/shipping`,
      shippingRate:{'@type':'MonetaryAmount',value:'49.00',currency:'GBP'},
      shippingDestination:{'@type':'DefinedRegion',addressCountry:'GB'},
      deliveryTime:{'@type':'ShippingDeliveryTime',
        handlingTime:{'@type':'QuantitativeValue',minValue:1,maxValue:2,unitCode:'DAY'},
        transitTime:{'@type':'QuantitativeValue',minValue:2,maxValue:5,unitCode:'DAY'}}},
    {'@type':'OfferShippingDetails','@id':`${SITE}#ship-eu`,shippingSettingsLink:`${SITE}/shipping`,url:`${SITE}/shipping`,
      shippingRate:{'@type':'MonetaryAmount',value:'59.00',currency:'GBP'},
      shippingDestination:{'@type':'DefinedRegion',addressCountry:['IE','FR','DE','ES','IT','NL','BE','AT','PT','PL','SE','DK','FI']},
      deliveryTime:{'@type':'ShippingDeliveryTime',
        handlingTime:{'@type':'QuantitativeValue',minValue:1,maxValue:2,unitCode:'DAY'},
        transitTime:{'@type':'QuantitativeValue',minValue:3,maxValue:6,unitCode:'DAY'}}},
    {'@type':'OfferShippingDetails','@id':`${SITE}#ship-ww`,shippingSettingsLink:`${SITE}/shipping`,url:`${SITE}/shipping`,
      shippingRate:{'@type':'MonetaryAmount',value:'159.00',currency:'GBP'},
      shippingDestination:{'@type':'DefinedRegion',addressCountry:['US','CA','AU','NZ']},
      deliveryTime:{'@type':'ShippingDeliveryTime',
        handlingTime:{'@type':'QuantitativeValue',minValue:1,maxValue:2,unitCode:'DAY'},
        transitTime:{'@type':'QuantitativeValue',minValue:3,maxValue:8,unitCode:'DAY'}}},
  ];
}

function buildSchema(p, url) {
  const colUrl=p.collectionSlug?`${SITE}/products-list/collections/${p.collectionSlug}`:`${SITE}/products-list`;
  return {
    '@context':'https://schema.org',
    '@graph':[
      ...buildSiteNodes(),
      {'@type':'BreadcrumbList','@id':`${url}#breadcrumb`,
        itemListElement:[
          {'@type':'ListItem',position:1,name:'Power Steering Rack Direct',item:SITE},
          {'@type':'ListItem',position:2,name:p.brand||'',item:colUrl},
          {'@type':'ListItem',position:3,name:p.name,item:url},
        ]},
      {'@type':'Product','@id':`${url}#product`,
        name:p.name,
        sku:p.sku||undefined,
        mpn:p.mpn||undefined,
        brand:{'@type':'Brand',name:p.brand||''},
        category:'Automotive Parts > Steering > Steering Racks',
        description:p.intro||undefined,   // full description, not truncated
        image:(p.images||[]).map(img=>({'@type':'ImageObject',url:img.url,name:img.title||p.name})),
        additionalProperty:[
          {'@type':'PropertyValue',name:'Type',value:'Electric Power Steering (EPS) Rack & Pinion'},
          p.drive?{'@type':'PropertyValue',name:'Driver side',
            value:p.drive==='RHD'?'Right-Hand Drive (RHD)':'Left-Hand Drive (LHD)'}:null,
          ...(p.modules||[]).map(m=>({'@type':'PropertyValue',name:'Module Number',value:m})),
          ...(p.crossRefs||[]).map(r=>({'@type':'PropertyValue',name:'OE Reference Number',value:r})),
        ].filter(Boolean),
        isAccessoryOrSparePartFor:(p.fitments||[]).map(f=>({
          '@type':'Car',brand:{'@type':'Brand',name:f.make||p.brand||''},
          model:f.chassis?`${f.model} (${f.chassis})`:f.model,
          vehicleModelDate:f.yearFrom?(f.yearTo?`${f.yearFrom}\u2013${f.yearTo}`:`${f.yearFrom}\u2013`):undefined,
          steeringPosition:f.drive==='RHD'?'https://schema.org/RightHandDriving':
            f.drive==='LHD'?'https://schema.org/LeftHandDriving':undefined,
        })),
        offers:{
          '@type':'Offer',url,
          price:p.price,
          priceCurrency:p.currency||'GBP',
          // priceValidUntil intentionally omitted — these are fixed prices.
          // Google: "Do not include if your price doesn't expire."
          availability:p.availability,
          itemCondition:p.itemCondition,
          seller:{'@id':`${SITE}#store`},
          hasMerchantReturnPolicy:[{'@id':`${SITE}#rp-gb`},{'@id':`${SITE}#rp-eu`},{'@id':`${SITE}#rp-ww`}],
          shippingDetails:[{'@id':`${SITE}#ship-uk`},{'@id':`${SITE}#ship-eu`},{'@id':`${SITE}#ship-ww`}],
          warranty:{'@type':'WarrantyPromise',
            durationOfWarranty:{'@type':'QuantitativeValue',value:p.warrantyMonths||(p.condition==='Brand New'?12:6),unitCode:'MON'}},
        }},
    ],
  };
}

function renderHead(p, url) {
  const desc    = truncateWords(p.intro, 155);
  const ogImage = p.images?.[0]?.url||LOGO;
  const robots  = 'index,follow,max-image-preview:large';
  const schema  = buildSchema(p, url);
  return [
    `<meta name="ghl-product-id" content="${esc(p.id)}">`,
    `<title>${esc(p.name)}</title>`,
    `<link rel="canonical" href="${esc(url)}">`,
    `<link rel="alternate" hreflang="en-gb"    href="${esc(url)}">`,
    `<link rel="alternate" hreflang="x-default" href="${esc(url)}">`,
    `<meta name="description" content="${esc(desc)}">`,
    `<meta name="robots"    content="${robots}">`,
    `<meta name="googlebot" content="${robots}">`,
    `<meta property="og:title"       content="${esc(p.name)}">`,
    `<meta property="og:description" content="${esc(desc)}">`,
    `<meta property="og:type"        content="product">`,
    `<meta property="og:url"         content="${esc(url)}">`,
    `<meta property="og:image"       content="${esc(ogImage)}">`,
    `<meta name="twitter:card"        content="summary_large_image">`,
    `<meta name="twitter:title"       content="${esc(p.name)}">`,
    `<meta name="twitter:description" content="${esc(desc)}">`,
    `<meta name="twitter:image"       content="${esc(ogImage)}">`,
    `<script type="application/ld+json">${JSON.stringify(schema)}</script>`,
  ].join('\n    ');
}

export async function onRequest({ params, env, request }) {
  const { slug } = params;

  // Read live product from KV (populated by psrd-sync worker)
  const raw = await env.PRODUCTS.get(`product:${slug}`);
  if (!raw) {
    // Product not in KV — show 404
    const notFoundRes = await env.ASSETS.fetch(
      new Request(new URL('/404.html', request.url))
    );
    return new Response(await notFoundRes.text(), {
      status: 404,
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  }

  const product = JSON.parse(raw);

  // Fetch template.html from static assets
  const templateRes = await env.ASSETS.fetch(
    new Request(new URL('/template.html', request.url))
  );
  if (!templateRes.ok) {
    return new Response('Template missing', { status: 500 });
  }
  const template = await templateRes.text();

  // Render full HTML with live product data
  const url      = `${SITE}/product-details/product/${slug}`;
  const headHtml = renderHead(product, url);
  const fullHtml = template.replace('</head>', `    ${headHtml}\n  </head>`);

  return new Response(fullHtml, {
    status: 200,
    headers: {
      'Content-Type':  'text/html;charset=UTF-8',
      'Cache-Control': 'public, max-age=60',  // 1 min browser cache
    },
  });
}
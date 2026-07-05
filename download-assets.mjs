import fs   from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LIVE      = 'https://powersteeringrackdirect.com';
const DIST      = path.join(__dirname, 'dist');
const PUBLIC    = path.join(__dirname, 'public');

async function get(url, dest) {
  console.log(`  Downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(buf));
}

async function run() {
  console.log('Creating dist/ ...');
  fs.mkdirSync(path.join(DIST, 'assets'), { recursive: true });

  await get(`${LIVE}/index.html`, path.join(DIST, 'index.html'));

  const html    = fs.readFileSync(path.join(DIST, 'index.html'), 'utf-8');
  const jsFile  = (/src="(\/assets\/[^"]+\.js)"/.exec(html)  || [])[1];
  const cssFile = (/href="(\/assets\/[^"]+\.css)"/.exec(html) || [])[1];

  if (!jsFile || !cssFile) throw new Error('Could not find JS/CSS in index.html');

  await get(`${LIVE}${jsFile}`,  path.join(DIST, jsFile));
  await get(`${LIVE}${cssFile}`, path.join(DIST, cssFile));

  for (const f of ['favicon.svg', 'ghl-store-script.js', 'placeholder.svg']) {
    try { await get(`${LIVE}/${f}`, path.join(DIST, f)); }
    catch { console.log(`  Skipped: ${f}`); }
  }

  console.log('Copying public/ files...');
  for (const f of fs.readdirSync(PUBLIC)) {
    fs.copyFileSync(path.join(PUBLIC, f), path.join(DIST, f));
    console.log(`  Copied: ${f}`);
  }

  console.log('\n? dist/ ready. Now run: node generate-ssg.mjs');
}

run().catch(err => { console.error('\n?', err.message); process.exit(1); });
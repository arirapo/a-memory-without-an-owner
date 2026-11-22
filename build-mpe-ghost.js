'use strict';

// MPE Ghost Manifest update: changes only background image selection/serving.
// Run from the root of the current a-memory-without-an-owner checkout.
// The script deliberately does not edit the memory engine, /offer, /experiment,
// receipt code, database, or any of the image-processing functions.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const serverFile = path.join(root, 'server.js');
const artworkFile = path.join(root, 'living-memory.html');
const manifestFile = path.join(root, 'ghost', 'ghost-images.json');

const oldServer = fs.readFileSync(serverFile, 'utf8');
const oldArtwork = fs.readFileSync(artworkFile, 'utf8');
const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));

const safeName = /^R\d{7}\.jpeg$/;
if (manifest.version !== 1 || manifest.selection !== 'random' ||
    !Array.isArray(manifest.images) || manifest.images.length < 1 ||
    manifest.images.length > 100 ||
    !manifest.images.every(n => typeof n === 'string' && safeName.test(n)) ||
    new Set(manifest.images).size !== manifest.images.length) {
  throw Error('Invalid ghost-images.json manifest');
}

const missing = manifest.images.filter(n => !fs.existsSync(path.join(root, 'ghost', n)));
if (missing.length) {
  throw Error('Missing ghost images in local checkout: ' + missing.join(', '));
}

const oldServerBlock = `  // Optional curated ghost photographs: read-only, exact filenames.
  if (req.method === 'GET' && (p === '/ghost/R0012371.jpeg' || p === '/ghost/R0011165.jpeg')) {
    const fs = require('node:fs');
    const file = require('node:path').join(__dirname, 'ghost', p.slice('/ghost/'.length));
    try {
      const bytes = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
      return res.end(bytes);
    } catch { return json(res, 404, { error: 'ghost_unavailable' }); }
  }
`;

const newServerBlock = `  // Public curated ghost list: random choices come from this manifest only.
  // Keep the directory private by allowing only listed JPEG files.
  if (req.method === 'GET' && p.startsWith('/ghost/')) {
    const fs = require('node:fs');
    const path = require('node:path');
    const name = p.slice('/ghost/'.length);
    let catalogue;

    try {
      catalogue = JSON.parse(fs.readFileSync(
        path.join(__dirname, 'ghost', 'ghost-images.json'), 'utf8'
      ));
      if (catalogue.version !== 1 || catalogue.selection !== 'random' ||
          !Array.isArray(catalogue.images) || catalogue.images.length > 100 ||
          !catalogue.images.every(x => typeof x === 'string' && /^R\\d{7}\\.jpeg$/.test(x))) {
        throw Error('invalid_ghost_manifest');
      }
    } catch (error) {
      console.error('Ghost manifest:', error.code || error.message);
      return json(res, 503, { error: 'ghost_manifest_unavailable' });
    }

    if (name === 'ghost-images.json') {
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(JSON.stringify(catalogue));
    }

    if (!catalogue.images.includes(name)) {
      return json(res, 404, { error: 'ghost_not_listed' });
    }

    try {
      const bytes = fs.readFileSync(path.join(__dirname, 'ghost', name));
      res.writeHead(200, {
        'Content-Type': 'image/jpeg',
        'Cache-Control': 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff'
      });
      return res.end(bytes);
    } catch {
      return json(res, 404, { error: 'ghost_unavailable' });
    }
  }
`;

const oldArtworkBlock = `const ghost=new Image();ghost.onload=()=>{photo=ghost;ghostCache=null};ghost.src='/ghost/'+(Math.random()<.5?'R0012371.jpeg':'R0011165.jpeg');`;
const newArtworkBlock = `// Image choice only: preserve existing ghost processing and visual settings.
const ghost=new Image();ghost.onload=()=>{photo=ghost;ghostCache=null};
const ghostFallback=['R0012371.jpeg','R0011165.jpeg'];
const randomGhost=a=>a[Math.floor(Math.random()*a.length)];
async function chooseGhost(){
  let images=ghostFallback;
  try{
    const response=await fetch('/ghost/ghost-images.json',{cache:'no-store'});
    if(!response.ok)throw Error('Ghost manifest HTTP '+response.status);
    const data=await response.json();
    if(!Array.isArray(data.images)||!data.images.length)throw Error('Empty ghost manifest');
    const filtered=data.images.filter(n=>typeof n==='string'&&/^R\\d{7}\\.jpeg$/.test(n));
    if(!filtered.length)throw Error('Invalid ghost list');
    images=filtered;
  }catch(error){console.warn('Using original ghost fallback:',error.message)}
  const selected=randomGhost(images);
  ghost.onerror=()=>{
    ghost.onerror=null;
    if(!ghostFallback.includes(selected))ghost.src='/ghost/'+randomGhost(ghostFallback);
  };
  ghost.src='/ghost/'+selected;
}
chooseGhost();`;

function replaceExactlyOnce(source, oldBlock, newBlock, label) {
  const at = source.indexOf(oldBlock);
  if (at === -1 || source.indexOf(oldBlock, at + oldBlock.length) !== -1) {
    throw Error('Expected exactly one original ' + label + ' block; source not modified');
  }
  return source.replace(oldBlock, newBlock);
}

if (oldServer.includes('ghost_not_listed') || oldArtwork.includes('chooseGhost()')) {
  throw Error('Ghost manifest logic already installed. Refusing duplicate modification.');
}

const newServer = replaceExactlyOnce(oldServer, oldServerBlock, newServerBlock, 'server');
const newArtwork = replaceExactlyOnce(oldArtwork, oldArtworkBlock, newArtworkBlock, 'artwork');

new vm.Script(newServer, { filename: 'server.js' });
const script = newArtwork.match(/<script>([\s\S]*?)<\/script>/);
if (!script) throw Error('Artwork inline script missing');
new vm.Script(script[1], { filename: 'living-memory.html inline script' });

// Keep a locally reviewable copy, not intended for GitHub.
fs.copyFileSync(serverFile, serverFile + '.before-ghost-manifest');
fs.copyFileSync(artworkFile, artworkFile + '.before-ghost-manifest');
fs.writeFileSync(serverFile, newServer);
fs.writeFileSync(artworkFile, newArtwork);
console.log('Ghost manifest installed: ' + manifest.images.length + ' images.');
console.log('Updated only server.js and living-memory.html.');
console.log('Current image processing, memory, /offer, /experiment and receipts untouched.');

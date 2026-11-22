'use strict';
// MPE 1.2 experimental camera/audio/video interface + private receipt laboratory.
// Run in MPE 1.1 source checkout. Does not modify the memory engine or database.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const dir=__dirname,serverPath=path.join(dir,'server.js'),server=fs.readFileSync(serverPath,'utf8');
if(!server.includes("p === '/experiment'"))throw Error('MPE 1.1 experiment route missing');
if(server.includes("p === '/receipt-lab'"))throw Error('MPE 1.2 already installed');
const names=['experimental-offer.html','receipt-lab.html','mpe-qr.js','receipt-kit.js','receipt-poetry-lexicon.json'];
for(const name of names)if(!fs.existsSync(path.join(dir,name)))throw Error('Missing '+name);
for(const name of ['experimental-offer.html','receipt-lab.html']){
 const html=fs.readFileSync(path.join(dir,name),'utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(x=>x[1].trim());
 if(scripts.length!==1)throw Error('Expected one inline script in '+name);
 new vm.Script(scripts[0][1],{filename:name});
}
for(const name of ['mpe-qr.js','receipt-kit.js'])new vm.Script(fs.readFileSync(path.join(dir,name),'utf8'),{filename:name});
const lex=JSON.parse(fs.readFileSync(path.join(dir,'receipt-poetry-lexicon.json'),'utf8'));
if(!lex.templates||!lex.modeWeights||!Array.isArray(lex.singleWords))throw Error('Invalid lexicon');
const anchor="  if (req.method === 'GET' && p === '/experiment') {";
if(server.split(anchor).length!==2)throw Error('Unexpected experiment route structure');
const extra=`
  // Static, same-origin assets for the experiment and receipt research.
  if (req.method === 'GET' && [
    '/mpe-qr.js','/receipt-kit.js','/receipt-poetry-lexicon.json','/receipt-lab'
  ].includes(p)) {
    const fs = require('node:fs');
    const path = require('node:path');
    const items = {
      '/mpe-qr.js': ['mpe-qr.js','application/javascript; charset=utf-8'],
      '/receipt-kit.js': ['receipt-kit.js','application/javascript; charset=utf-8'],
      '/receipt-poetry-lexicon.json': ['receipt-poetry-lexicon.json','application/json; charset=utf-8'],
      '/receipt-lab': ['receipt-lab.html','text/html; charset=utf-8']
    };
    const [filename,ctype] = items[p];
    res.writeHead(200,{
      'Content-Type': ctype,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options':'nosniff',
      'Referrer-Policy':'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
        "media-src 'self' blob:; connect-src 'self'; " +
        "object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    });
    return res.end(fs.readFileSync(path.join(__dirname,filename)));
  }

`;
let updated=server.replace(anchor,extra+anchor);
// The existing experiment CSP already permits same-origin scripts and camera/mic prompts.
updated=updated.replace("version: '1.0.0-beta.1'","version: '1.2.0-experiment'");
new vm.Script(updated,{filename:'server.js'});
fs.copyFileSync(serverPath,serverPath+'.before-mpe12');
fs.writeFileSync(serverPath,updated);
console.log('MPE 1.2 experimental interface installed.');
console.log('New /experiment: image, short audio and video, HTML, colour.');
console.log('New /receipt-lab: stand-alone QR poetry keepsakes.');
console.log('Original /offer, /, /studio and the MPE memory database untouched.');

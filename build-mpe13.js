'use strict';
// MPE 1.3 — Shared I was here SVG keepsake for public and experimental offers.
// Install in the working MPE 1.2 checkout. No engine, server or database changes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const dir=__dirname;
const pagePath=path.join(dir,'leave-a-trace.html');
const kitPath=path.join(dir,'receipt-kit.js');
const qrPath=path.join(dir,'mpe-qr.js');
const lexPath=path.join(dir,'receipt-poetry-lexicon.json');
for(const p of [pagePath,kitPath,qrPath,lexPath]){
 if(!fs.existsSync(p))throw Error('Missing required file: '+path.basename(p));
}
const original=fs.readFileSync(pagePath,'utf8');
if(original.includes('MPEReceipt.create(data)'))throw Error('Public form already uses shared receipt module');
if(!original.includes("async function offer(silent){")||!original.includes("function receipt(data){")){
 throw Error('Unexpected public form source: no changes applied');
}
if(!original.includes("receipt(data);")||!original.includes("<script>")){
 throw Error('Expected original receipt call or inline script missing');
}
const p1=original.indexOf('function receipt(data){');
const p2=original.indexOf('async function offer(silent){',p1);
if(p2<=p1)throw Error('Could not identify original receipt function');
const updatedReceipt=String.raw`async function receipt(data){
  const box=$('receipt');
  box.replaceChildren();
  box.hidden=false;
  try{
    const keepsake=await MPEReceipt.create(data);
    box.append(keepsake.svg);
    const note=document.createElement('p');
    note.textContent='Your trace was accepted. Its moment is yet to come.';
    box.append(note);
    const save=document.createElement('button');
    save.textContent='Save my keepsake SVG';
    save.onclick=()=>MPEReceipt.download(keepsake.svg,data.id);
    const letGo=document.createElement('button');
    letGo.className='secondary';
    letGo.textContent='Let it go';
    letGo.onclick=()=>{box.replaceChildren();box.hidden=true};
    box.append(save,letGo);
  }catch(error){
    // The submission has already been ACCEPTED. An unavailable QR must never
    // cause a second offering or a misleading "submission uncertain" message.
    const note=document.createElement('p');
    note.textContent='Your trace was accepted, but its keepsake could not be prepared: '+error.message;
    box.append(note);
  }
}

`;
let updated=original.slice(0,p1)+updatedReceipt+original.slice(p2);
updated=updated.replace("    receipt(data);","    await receipt(data);");
updated=updated.replace('<script>','<script src="/mpe-qr.js"></script>\n<script src="/receipt-kit.js"></script>\n<script>');
if(!updated.includes('await receipt(data);')||!updated.includes('src="/receipt-kit.js"')){
 throw Error('Receipt integration incomplete');
}
// Browser assets must be served by the existing MPE 1.2 server.
const server=fs.readFileSync(path.join(dir,'server.js'),'utf8');
for(const required of ["'/mpe-qr.js'","'/receipt-kit.js'","'/receipt-poetry-lexicon.json'"]){
 if(!server.includes(required))throw Error('MPE 1.2 static route missing: '+required);
}
const scripts=[...updated.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m=>m[1].trim());
if(scripts.length!==1)throw Error('Expected exactly one inline script in updated offer page');
new vm.Script(scripts[0][1],{filename:'leave-a-trace.html'});
new vm.Script(fs.readFileSync(kitPath,'utf8'),{filename:'receipt-kit.js'});
new vm.Script(fs.readFileSync(qrPath,'utf8'),{filename:'mpe-qr.js'});
const lex=JSON.parse(fs.readFileSync(lexPath,'utf8'));
if(!lex.modeWeights||!lex.templates)throw Error('Invalid poetry lexicon');
fs.copyFileSync(pagePath,pagePath+'.before-mpe13');
fs.writeFileSync(pagePath,updated);
console.log('MPE 1.3 installed.');
console.log('Shared QR keepsake enabled on /offer and /experiment.');
console.log('Vertical artwork signature is in receipt-kit.js.');
console.log('Memory engine, database, and living memory untouched.');


'use strict';

// MPE 0.6: install a read-only artwork preview without changing memory.
// Run at repository root once; does not overwrite a previous installation.
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const dir=__dirname;
const serverPath=path.join(dir,'server.js');
const adapterPath=path.join(dir,'mpe05.js');
const viewPath=path.join(dir,'living-memory.html');
if(fs.existsSync(viewPath)) throw Error('living-memory.html already exists. Refusing to overwrite.');
let server=fs.readFileSync(serverPath,'utf8');
let adapter=fs.readFileSync(adapterPath,'utf8');
if(server.includes('/api/artwork/state')||adapter.includes('artworkState')) throw Error('0.6 seems installed already');
const insertion="  if (req.method === 'GET' && p === '/api/test/marker') {";
if(!server.includes(insertion)|| !adapter.includes('module.exports = {')) throw Error('Unexpected MPE 0.5 source; no changes were made');
const photoRoute=`  // Optional curated ghost photographs: read-only, exact filenames.\n  if (req.method === 'GET' && (p === '/ghost/R0012371.jpeg' || p === '/ghost/R0011165.jpeg')) {\n    const fs = require('node:fs');\n    const file = require('node:path').join(__dirname, 'ghost', p.slice('/ghost/'.length));\n    try {\n      const bytes = fs.readFileSync(file);\n      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });\n      return res.end(bytes);\n    } catch { return json(res, 404, { error: 'ghost_unavailable' }); }\n  }\n\n`;
const endpoint=`  // Read-only public visual snapshot. No mutation or simulation.\n  if (req.method === 'GET' && p === '/api/artwork/state') {\n    try {\n      const memory = await mpe05.read();\n      if (!memory) return json(res, 503, { error: 'artwork_not_initialized' });\n      return json(res, 200, mpe05.artworkState(memory));\n    } catch (error) {\n      console.error('Artwork snapshot:', error.code || error.message);\n      return json(res, 503, { error: 'artwork_unavailable' });\n    }\n  }\n\n  if (req.method === 'GET' && p === '/living-memory.html') {\n    const fs = require('node:fs');\n    res.writeHead(200, {\n      'Content-Type': 'text/html; charset=utf-8',\n      'Cache-Control': 'no-store',\n      'X-Content-Type-Options': 'nosniff',\n      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"\n    });
    return res.end(fs.readFileSync(require('node:path').join(__dirname,'living-memory.html')));
  }

`;
server=server.replace(insertion,photoRoute+endpoint+insertion);
const exportAnchor='module.exports = {';
const stateFn=`// Presentation-only shape: never exposes stored raw input or administrative controls.\nfunction artworkState(memory) {\n  const d = createEngine(check(memory)).diagnostic();\n  return {\n    revision: memory.revision, days: d.days, offers: d.offers,\n    forgotten: d.forgotten, regenerations: d.regenerations,\n    echoes: d.echoes, weather: d.weather, nodes: d.nodes,\n    field: d.field, deepField: d.deepField, deepStats: d.deepStats\n  };\n}\n\n`;
adapter=adapter.replace(exportAnchor,stateFn+exportAnchor);
adapter=adapter.replace('  summary\n};','  summary,\n  artworkState\n};');
if(!adapter.includes('  artworkState\n};')) throw Error('Adapter export patch failed');
const html=String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>A Memory Without an Owner — Living Memory</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0b1119;color:#ebe7e1;font:14px/1.5 system-ui,sans-serif}main{max-width:1380px;margin:0 auto;padding:24px 22px}.eyebrow{color:#9eb6bc;letter-spacing:.16em;font:11px monospace}h1{font:normal clamp(36px,5.8vw,72px)/1.04 Georgia,serif;margin:24px 0 8px}.subtitle{font:italic clamp(16px,2vw,21px) Georgia,serif;color:#e4b991;margin:0 0 27px}.art{position:relative;aspect-ratio:2/1;background:#091620;border:1px solid #344753;border-radius:15px;overflow:hidden}canvas{width:100%;height:100%;display:block}.bottom{display:flex;justify-content:space-between;gap:20px;align-items:center;margin-top:14px;color:#93a9b1;font:12px system-ui}.status{max-width:80%}.meta{letter-spacing:.07em;font:11px monospace;color:#c5a789}a{color:inherit} @media(max-width:600px){main{padding:14px 9px}h1{margin-top:20px}.bottom{font-size:11px}}
</style>
</head>
<body><main>
<div class="eyebrow">TRACES BETWEEN / A MEMORY WITHOUT AN OWNER</div>
<h1>The memory remembers beneath itself.</h1>
<p class="subtitle">What disappears as an event may remain as a field.</p>
<div class="art"><canvas id="art" aria-label="Living generative memory landscape"></canvas></div>
<div class="bottom"><span class="status" id="status">Connecting to the memory…</span><span class="meta" id="meta">MPE 0.6 / READ ONLY</span></div>
</main>
<script>
(()=>{'use strict';
const canvas=document.getElementById('art'),g=canvas.getContext('2d');
const status=document.getElementById('status'),meta=document.getElementById('meta');
let memory=null,phase=0,fieldCanvas=null,fieldKey='',photo=null,ghostCache=null;
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const ghost=new Image();ghost.onload=()=>{photo=ghost;ghostCache=null};ghost.src='/ghost/'+(Math.random()<.5?'R0012371.jpeg':'R0011165.jpeg');
function buildField(){
  if(!memory?.deepField||memory.deepField.length!==2048)return;
  const key=memory.revision+'|'+memory.days;
  if(fieldCanvas&&key===fieldKey)return;
  fieldKey=key;const c=document.createElement('canvas');c.width=64;c.height=32;
  const x=c.getContext('2d'),image=x.createImageData(64,32),mean=memory.deepStats?.mean||0;
  for(let i=0;i<2048;i++){
    const v=clamp((memory.deepField[i]-mean)*3.2+memory.deepField[i]*.22),k=i*4;
    image.data[k]=18+v*110;image.data[k+1]=33+v*145;image.data[k+2]=45+v*120;image.data[k+3]=v*180;
  }
  x.putImageData(image,0,0);fieldCanvas=c;
}
function paintGhost(w,h){if(!photo)return;const cw=Math.max(20,Math.floor(w/18)),ch=Math.max(10,Math.floor(h/18));if(!ghostCache||ghostCache.width!==cw||ghostCache.height!==ch){const c=document.createElement('canvas');c.width=cw;c.height=ch;const x=c.getContext('2d');const z=Math.max(cw/photo.width,ch/photo.height);x.drawImage(photo,(cw-photo.width*z)/2,(ch-photo.height*z)/2,photo.width*z,photo.height*z);const p=x.getImageData(0,0,cw,ch);for(let i=0;i<p.data.length;i+=4){const l=(p.data[i]*.299+p.data[i+1]*.587+p.data[i+2]*.114)*.18;p.data[i]=l*.6;p.data[i+1]=l*.83;p.data[i+2]=l;}x.putImageData(p,0,0);ghostCache=c;}g.save();g.globalAlpha=.45;g.imageSmoothingEnabled=false;g.drawImage(ghostCache,0,0,w,h);g.restore()}
function groupShapes(nodes){const groups=new Map();for(const n of nodes){if(n.anchor)continue;const key=Math.floor(n.x*6)+':'+Math.floor(n.y*5);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(n)}return [...groups.values()].filter(a=>a.length>=4).map(a=>({x:a.reduce((v,n)=>v+n.x,0)/a.length,y:a.reduce((v,n)=>v+n.y,0)/a.length,r:Math.min(.16,.03+a.length*.002),s:a.reduce((v,n)=>v+n.s,0)/a.length}))}
function render(){requestAnimationFrame(render);const box=canvas.getBoundingClientRect(),w=box.width,h=box.height,dpr=Math.min(2,devicePixelRatio||1);if(!w||!h)return;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr)}
  g.setTransform(dpr,0,0,dpr,0,0);g.fillStyle='#091620';g.fillRect(0,0,w,h);if(!memory)return;phase+=.004;
  buildField();if(fieldCanvas){g.save();g.globalAlpha=.29;g.imageSmoothingEnabled=true;g.drawImage(fieldCanvas,0,0,w,h);g.restore()}paintGhost(w,h);
  const nodes=memory.nodes||[],f=memory.field||Array(8).fill(.5),s=Math.min(w,h);
  const o=groupShapes(nodes);for(let j=0;j<o.length;j++){const m=o[j],cx=m.x*w,cy=m.y*h,r=m.r*s*2.2;g.beginPath();for(let k=0;k<=48;k++){const a=k*Math.PI*2/48,d=1+.13*Math.sin(a*5+j*4+phase*.08)+.07*Math.cos(a*3+memory.days*.02),px=cx+Math.cos(a)*r*d,py=cy+Math.sin(a)*r*.8*d;if(k)g.lineTo(px,py);else g.moveTo(px,py)}g.closePath();g.fillStyle='rgba(131,174,173,'+(.02+m.s*.055)+')';g.fill();g.strokeStyle='rgba(157,192,188,.11)';g.stroke()}
  const pts=nodes.map(n=>({n,x:(n.x+Math.sin(phase*.5+n.h)*.004*f[5])*w,y:(n.y+Math.cos(phase*.35+n.h)*.004*f[5])*h}));
  for(let i=0;i<pts.length;i++){const a=pts[i];for(let j=Math.max(0,i-20);j<i;j++){const b=pts[j],dist=Math.hypot(a.x-b.x,a.y-b.y),limit=s*(.10+.18*f[4]);if(dist<limit){g.beginPath();g.moveTo(a.x,a.y);g.lineTo(b.x,b.y);g.strokeStyle='rgba(159,204,211,'+((.04+.15*f[4])*(1-dist/limit)*a.n.s)+')';g.lineWidth=.65;g.stroke()}}
    g.beginPath();g.arc(a.x,a.y,a.n.anchor?4:(a.n.echo?1+a.n.s*2.6:1.4+a.n.s*1.3),0,Math.PI*2);g.fillStyle=a.n.anchor?'#e9ba90':a.n.echo?'rgba(191,165,219,'+clamp(.12+a.n.s*1.2)+')':'hsla('+(162+a.n.h*.24)+',50%,80%,'+clamp(.2+a.n.s*.85)+')';g.fill();if(a.n.echo){g.beginPath();g.arc(a.x,a.y,4+a.n.s*9,0,Math.PI*2);g.strokeStyle='rgba(191,165,219,'+(.08+a.n.s*.25)+')';g.stroke()}}
}
async function refresh(){try{const r=await fetch('/api/artwork/state',{cache:'no-store'});if(!r.ok)throw Error('HTTP '+r.status);const data=await r.json();if(!Array.isArray(data.nodes)||!Array.isArray(data.deepField))throw Error('Invalid memory snapshot');memory=data;status.textContent='Connected · shared memory · '+data.weather+' · '+data.days.toFixed(1)+' simulated days';meta.textContent='MPE 0.6 · '+data.offers+' TRACES · '+data.regenerations+' ECHOES';}catch(e){status.textContent='Memory unavailable: '+e.message}}
refresh();setInterval(refresh,8000);requestAnimationFrame(render);
})();
</script></body></html>`;
// Validate embedded HTML script and both patched JS files before saving.
const embedded=html.match(/<script>\s*([\s\S]*?)<\/script>/);
if(!embedded)throw Error('Missing browser JavaScript');
new vm.Script(embedded[1],{filename:'living-memory.html/script'});
new vm.Script(server,{filename:'server.js'});
new vm.Script(adapter,{filename:'mpe05.js'});
// Write new file first, then update existing code with recoverable backups.
fs.copyFileSync(serverPath,serverPath+'.before-mpe06');
fs.copyFileSync(adapterPath,adapterPath+'.before-mpe06');
fs.writeFileSync(viewPath,html,{flag:'wx'});
fs.writeFileSync(serverPath,server);
fs.writeFileSync(adapterPath,adapter);
console.log('Created living-memory.html');
console.log('Updated server.js and mpe05.js');
console.log('Backups saved as *.before-mpe06');
console.log('MPE 0.6 build completed.');

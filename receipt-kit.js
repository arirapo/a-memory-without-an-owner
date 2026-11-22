/* MPE Receipt 1.3 — browser-only keepsake. No original material is stored. */
(function(root){'use strict';
const NS='http://www.w3.org/2000/svg';
let lexiconPromise;
function seedNumber(s){let h=2166136261;for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);return h>>>0;}
function rng(seed){let x=seed>>>0;return ()=>{x+=0x6D2B79F5;let t=x;t=Math.imul(t^t>>>15,t|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};}
function pick(a,r){return a[Math.floor(r()*a.length)];}
function normalize(s){return s.replace(/ +/g,' ').replace(/\s+\//g,' /').trim();}
function loadLexicon(){if(!lexiconPromise)lexiconPromise=fetch('/receipt-poetry-lexicon.json',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Poetry lexicon unavailable');return r.json();});return lexiconPromise;}
function poemFor(id,L){const r=rng(seedNumber(id+'|poem'));const weights=Object.entries(L.modeWeights);let n=r()*weights.reduce((a,x)=>a+x[1],0);let selected=weights[weights.length-1][0];for(const [key,w] of weights){n-=w;if(n<0){selected=key;break;}}
 const pat=pick(L.templates[selected],r);
 const dict={singleWord:'singleWords',noun:'nouns',verb:'verbs',adjective:'adjectives',timeWord:'timeWords',spaceWord:'spaceWords',state:'states',fragment:'fragments',onomatopoeia:'onomatopoeia',silence:'silences',asciiGlyph:'asciiGlyphs',traceWord:'special.traceWord'};
 let poem=pat.replace(/\{(\w+)\}/g,(_,key)=>{const name=dict[key];if(!name)throw Error('Unknown poetry token '+key);const arr=name.startsWith('special.')?L.special[name.split('.')[1]]:L[name];return pick(arr,r);});
 poem=normalize(poem.replace(/\s*\/\s*/g,'\n'));
 const words=poem.trim().split(/\s+/).filter(Boolean);
 if(words.length>L.maxWords)poem=words.slice(0,L.maxWords).join(' ');
 if(!poem)poem='.';
 return poem;
}
function el(tag,props={},parent){const node=document.createElementNS(NS,tag);for(const [k,v] of Object.entries(props))node.setAttribute(k,String(v));if(parent)parent.append(node);return node;}
function drawQr(svg,text,x,y,size){const qr=root.MPEQRCode(text),n=qr.getModuleCount(),quiet=4,cell=size/(n+quiet*2);el('rect',{x,y,width:size,height:size,fill:'#f3e7d7'},svg);const g=el('g',{fill:'#162732'},svg);for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(qr.isDark(j,i))el('rect',{x:x+(i+quiet)*cell,y:y+(j+quiet)*cell,width:cell+.04,height:cell+.04},g);return n;}
function receiptSVG({id,at,poem}){if(typeof root.MPEQRCode!=='function')throw Error('QR encoder not loaded');const r=rng(seedNumber(id+'|picture'));const hue=Math.round(r()*360);const svg=el('svg',{xmlns:NS,viewBox:'0 0 360 550',width:'360',height:'550',role:'img','aria-label':'Unique I was here keepsake with a hidden QR poem'});
 const defs=el('defs',{},svg),grad=el('linearGradient',{id:'memoryGradient',x1:'0',x2:'1',y1:'0',y2:'1'},defs);el('stop',{offset:'0%','stop-color':`hsl(${hue},30%,18%)`},grad);el('stop',{offset:'100%','stop-color':`hsl(${(hue+55)%360},30%,9%)`},grad);
 el('rect',{width:360,height:550,fill:'url(#memoryGradient)'},svg);el('rect',{x:13,y:13,width:334,height:524,rx:7,fill:'none',stroke:'#d9c09d','stroke-opacity':'.35'},svg);
 // An archival signature, quiet enough not to compete with the artwork.
 // This text is part of the SVG itself, so it survives offline and in saved copies.
 const imprint=el('text',{x:27,y:275,transform:'rotate(-90 27 275)','text-anchor':'middle',fill:'#e6ceb0','fill-opacity':'.53','font-family':'monospace','font-size':8,'letter-spacing':1.8},svg);
 imprint.textContent='A MEMORY WITHOUT AN OWNER';

 for(let i=0;i<32;i++){const a=i*2.399963,radius=8+i*4.2,cx=180+Math.cos(a)*radius,cy=174+Math.sin(a)*radius;el('ellipse',{cx,cy,rx:8+(i%6)*4+r()*5,ry:8+(i%5)*5+r()*4,transform:`rotate(${Math.floor(r()*180)} ${cx} ${cy})`,fill:'none',stroke:`hsl(${(hue+i*11)%360},${38+Math.round(r()*35)}%,${59+Math.round(r()*24)}%)`,'stroke-width':.9+r()*.6,'stroke-opacity':(.15+r()*.56).toFixed(3)},svg);}
 const title=el('text',{x:180,y:311,'text-anchor':'middle',fill:'#f2e9dd','font-family':'Georgia,serif','font-size':25},svg);title.textContent='I was here.';
 const date=el('text',{x:180,y:334,'text-anchor':'middle',fill:'#bcb7b5','font-family':'monospace','font-size':10},svg);date.textContent=new Date(at).toISOString();
 // The QR content is deliberately plain text. Decoding never calls a website.
 const payload='I was here.\n'+poem+'\n'+new Date(at).toISOString()+'\n#'+id;
 drawQr(svg,payload,116,350,128);
 const hint=el('text',{x:180,y:518,'text-anchor':'middle',fill:'#c6b29c','font-family':'Georgia,serif','font-size':10,'font-style':'italic'},svg);hint.textContent='Keep it, or let it disappear.';
 return svg;}
async function create(data){const L=await loadLexicon();const poem=poemFor(data.id,L);return {svg:receiptSVG({...data,poem}),poem,id:data.id};}
function download(svg,id){const xml=new XMLSerializer().serializeToString(svg);const blob=new Blob([xml],{type:'image/svg+xml;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='I-was-here-'+id.slice(0,8)+'.svg';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
root.MPEReceipt={create,download,loadLexicon,poemFor,receiptSVG};
})(window);

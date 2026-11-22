
'use strict';

// MPE 1.1 research extension — experimental, studio-only offering.
// Run in a checkout of the working MPE 1.0 beta.
// Does not change the memory engine, database or existing art pages.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const serverPath = path.join(root, 'server.js');
const experimentPath = path.join(root, 'experimental-offer.html');

const server = fs.readFileSync(serverPath, 'utf8');
const html = fs.readFileSync(experimentPath, 'utf8');

const needle = "  if (\n    req.method === 'GET' &&\n    p === '/leave-a-trace.html'";

if (!server.includes('function studioAuthorized(')) {
  throw Error('MPE 1.0 beta with protected /studio is required');
}

if (server.includes("p === '/experiment'")) {
  throw Error('The experimental offering route is already installed');
}

if (server.split(needle).length !== 2) {
  throw Error('Expected the existing participation route exactly once');
}

if (!html.includes('id="featureBars"') || !html.includes('/api/offer')) {
  throw Error('Experimental offering file is missing required elements');
}

const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];

if (scripts.length !== 1) {
  throw Error('Expected exactly one experiment script');
}

new vm.Script(scripts[0][1], {
  filename: 'experimental-offer.html'
});

const route = `
  // Artist-only research instrument. Not linked from the public artwork.
  // Its inputs are processed only in the browser; the existing /api/offer
  // accepts only eight numerical features and a UUID.
  if (req.method === 'GET' && p === '/experiment') {
    if (!studioAuthorized(req)) return studioChallenge(res);

    const fs = require('node:fs');
    const path = require('node:path');

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'none'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; img-src 'self' blob: data:; " +
        "media-src 'self' blob:; object-src 'none'; " +
        "base-uri 'none'; frame-ancestors 'none'"
    });

    return res.end(
      fs.readFileSync(
        path.join(__dirname, 'experimental-offer.html')
      )
    );
  }

`;

const updated = server.replace(needle, route + needle);

new vm.Script(updated, {
  filename: 'server.js'
});

fs.copyFileSync(serverPath, serverPath + '.before-mpe11');
fs.writeFileSync(serverPath, updated);

console.log('MPE 1.1 experimental offering installed.');
console.log('Private experimental form: /experiment');
console.log('Existing /offer, /, /studio and memory database untouched.');

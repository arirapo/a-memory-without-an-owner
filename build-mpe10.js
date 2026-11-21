
'use strict';

// MPE 1.0 Beta — Public Experience
// Builds clean routes and protects the studio.
// Based on the accepted MPE 0.9 source.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;

const files = [
  'server.js',
  'living-memory.html',
  'leave-a-trace.html',
  'package.json'
];

const data = Object.fromEntries(
  files.map(name => [
    name,
    fs.readFileSync(
      path.join(root, name),
      'utf8'
    )
  ])
);

if (data['server.js'].includes('function studioAuthorized(')) {
  throw Error('MPE 1.0 Beta already installed');
}

function replace(name, from, to) {
  const s = data[name];

  if (
    !s.includes(from) ||
    s.indexOf(from) !== s.lastIndexOf(from)
  ) {
    throw Error('Source mismatch: ' + name);
  }

  data[name] = s.replace(from, to);
}

// ------------------------------------------
// A. Studio authentication
// ------------------------------------------

const auth = `
function studioAuthorized(req) {
  if (ADMIN_KEY.length < 24) return false;

  const header = req.headers.authorization || '';

  if (!header.startsWith('Basic ')) return false;

  try {
    const decoded = Buffer.from(
      header.slice(6),
      'base64'
    ).toString('utf8');

    const colon = decoded.indexOf(':');

    if (colon < 0) return false;

    const username = decoded.slice(0, colon);
    const password = decoded.slice(colon + 1);

    if (username !== 'mpe') return false;

    const a = Buffer.from(password);
    const b = Buffer.from(ADMIN_KEY);

    return a.length === b.length &&
      crypto.timingSafeEqual(a, b);

  } catch {
    return false;
  }
}

function studioChallenge(res) {
  res.writeHead(401, {
    'WWW-Authenticate':
      'Basic realm="MPE Studio", charset="UTF-8"',
    'Cache-Control': 'no-store',
    'Content-Type': 'text/plain; charset=utf-8'
  });

  res.end('Administrator authentication required');
}

`;

replace(
  'server.js',
  'const page = `<!doctype html>',
  auth + 'const page = `<!doctype html>'
);

// ------------------------------------------
// B. Clean public routes
// ------------------------------------------

const routing = `
  // Private research studio.
  if (req.method === 'GET' && p === '/studio') {
    if (!studioAuthorized(req)) {
      return studioChallenge(res);
    }

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "object-src 'none'; base-uri 'none'; " +
        "frame-ancestors 'none'"
    });

    return res.end(page);
  }

  // Public artwork is now the main page.
  if (req.method === 'GET' && p === '/') {
    p = '/living-memory.html';
  }

  // Separate participation experience.
  if (req.method === 'GET' && p === '/offer') {
    p = '/leave-a-trace.html';
  }

`;

replace(
  'server.js',
  `  if (req.method === 'GET' && p === '/') {`,
  routing +
  `  if (req.method === 'GET' && p === '/') {`
);

// ------------------------------------------
// C. Protect old diagnostic reads
// ------------------------------------------

replace(
  'server.js',
  `  if (req.method === 'GET' && p === '/api/test/marker') {
    try {`,
  `  if (req.method === 'GET' && p === '/api/test/marker') {
    if (!authorized(req)) {
      return json(res, 401, {
        error: 'admin_key_required'
      });
    }

    try {`
);

replace(
  'server.js',
  `    if (p === '/api/memory/state' && req.method === 'GET') {
      try {`,
  `    if (p === '/api/memory/state' && req.method === 'GET') {
      if (!authorized(req)) {
        return json(res, 401, {
          error: 'admin_key_required'
        });
      }

      try {`
);

// The studio can send the admin key on GET requests,
// without changing the existing POST protections.

replace(
  'server.js',
  `      headers: method === 'POST'
        ? { 'X-MPE-Admin-Key': secret }
        : {}`,
  `      headers: secret
        ? { 'X-MPE-Admin-Key': secret }
        : {}`
);

// ------------------------------------------
// D. Update the admin interface wording
// ------------------------------------------

replace(
  'server.js',
  'Safe memory experiment 0.5',
  'MPE Studio — Private Administration'
);

replace(
  'server.js',
  `This private preview tests serialized memory updates.
No participant contributions are accepted yet.`,
  `Private memory diagnostics and research controls.
These functions are not part of the public artwork.`
);

replace(
  'server.js',
  "version: '0.9.0'",
  "version: '1.0.0-beta.1'"
);

// ------------------------------------------
// E. Connect the public experiences
// ------------------------------------------

replace(
  'living-memory.html',
  '<span class="meta" id="meta">MPE 0.6 / READ ONLY</span>',
  `<a href="/offer" class="meta" style="text-decoration:none;color:#e6bb92">Leave a trace</a>
<span class="meta" id="meta">MPE / LIVING MEMORY</span>`
);

replace(
  'leave-a-trace.html',
  'href="/living-memory.html"',
  'href="/"'
);

replace(
  'leave-a-trace.html',
  'MPE 0.7 · PRIVATE PREVIEW · Experimental participation',
  'A MEMORY WITHOUT AN OWNER · Experimental participation'
);

// ------------------------------------------
// F. Set release version
// ------------------------------------------

const pkg = JSON.parse(data['package.json']);
pkg.version = '1.0.0-beta.1';
data['package.json'] =
  JSON.stringify(pkg, null, 2) + '\n';

// ------------------------------------------
// G. Validate before writing
// ------------------------------------------

new vm.Script(
  data['server.js'],
  { filename: 'server.js' }
);

const studioScript = data['server.js'].match(
  /<script>([\s\S]*?)<\/script>/
);

if (!studioScript) {
  throw Error('Studio browser script missing');
}

new vm.Script(
  studioScript[1],
  { filename: 'studio-browser.js' }
);

for (const name of [
  'living-memory.html',
  'leave-a-trace.html'
]) {
  const match = data[name].match(
    /<script>([\s\S]*?)<\/script>/
  );

  if (!match) {
    throw Error('Browser script missing: ' + name);
  }

  new vm.Script(
    match[1],
    { filename: name }
  );
}

// ------------------------------------------
// H. Create backups, then install
// ------------------------------------------

for (const name of files) {
  fs.copyFileSync(
    path.join(root, name),
    path.join(root, name + '.before-mpe10')
  );
}

for (const name of files) {
  fs.writeFileSync(
    path.join(root, name),
    data[name]
  );
}

console.log('MPE 1.0 Beta installed.');
console.log('Public root: /');
console.log('Participation: /offer');
console.log('Protected studio: /studio');
console.log('Existing MySQL memory untouched.');

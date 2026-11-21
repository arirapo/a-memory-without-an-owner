
'use strict';

// A Memory Without an Owner — Production Experiment 0.4
// Portable persistence and protected concurrency test.
// Experimental only: no participant contributions are accepted.

const http = require('node:http');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const store = require('./memory-store');
const mpe05 = require('./mpe05');

const PORT = Number(process.env.PORT || 3000);
const ADMIN_KEY = process.env.MPE_ADMIN_KEY || '';
const startedAt = new Date().toISOString();

function json(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(value));
}

function authorized(req) {
  const supplied = req.headers['x-mpe-admin-key'];

  if (ADMIN_KEY.length < 24 || typeof supplied !== 'string') {
    return false;
  }

  const a = Buffer.from(supplied);
  const b = Buffer.from(ADMIN_KEY);

  return a.length === b.length &&
    crypto.timingSafeEqual(a, b);
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;

  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

// Read the original MySQL deployment marker without changing it.
async function oldMarker() {
  if (!process.env.DB_HOST) return null;

  const db = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 6000
  });

  try {
    const [rows] = await db.execute(
      `SELECT marker, created_at
       FROM mpe_deployment_test
       WHERE id = ?`,
      ['first-memory']
    );
    return rows[0] || null;
  } finally {
    await db.end();
  }
}

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>A Memory Without an Owner</title>
<style>
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body {
  margin: 0; min-height: 100vh; display: grid; place-items: center;
  background: #0b1119; color: #eee8df;
  font: 15px/1.6 system-ui,sans-serif;
}
main { width: min(90vw,800px); padding: 35px 0; }
small { color: #9db8bf; letter-spacing: .13em; }
h1 { font: normal clamp(37px,6vw,70px)/1.08 Georgia,serif; }
.lead { font: italic 20px Georgia,serif; color: #e6be94; }
section {
  border: 1px solid #344754; background: #17222e;
  padding: 22px; border-radius: 13px; margin-top: 28px;
}
button {
  background: #e6be94; color: #182730; border: 0;
  border-radius: 8px; padding: 11px 14px; font-weight: 700;
  cursor: pointer; margin: 6px 5px 6px 0;
}
button.secondary {
  background: #293d48; color: #eee8df; border: 1px solid #506b77;
}
button:disabled { opacity: .5; cursor: default; }
input {
  width: 100%; padding: 12px; border-radius: 8px;
  border: 1px solid #506b77; background: #0c1924;
  color: #eee8df;
}
label {
  display: block; color: #aebdc5;
  font-size: 13px; margin-top: 12px;
}
pre {
  white-space: pre-wrap; overflow-wrap: anywhere;
  color: #c7d7d9;
}
</style>
</head>
<body>
<main>
<small>TRACES BETWEEN / A MEMORY WITHOUT AN OWNER</small>
<h1>The memory has a place to live.</h1>
<p class="lead">Safe memory experiment 0.5</p>
<section>
<p>This private preview tests serialized memory updates.
No participant contributions are accepted yet.</p>

<button class="secondary" id="read">Read memory</button>
<button class="secondary" id="old">Check first MySQL marker</button>

<label for="key">Admin key — used only for this request</label>
<input id="key" type="password" autocomplete="off" spellcheck="false">

<button id="seed">Initialize test memory</button>
<button id="pulse">Add one test pulse</button>
<button id="concurrent">Test 20 simultaneous updates</button>

<p><strong>MPE 0.5 — isolated memory engine</strong></p>

<button id="mpeInit">Initialize MPE 0.5</button>
<button id="mpeView" class="secondary">Inspect MPE 0.5</button>
<button id="mpeSim">Simulate 10 traces</button>
<button id="mpeAge">Advance 30 days</button>

<pre id="result">Ready.</pre>
</section>
</main>
<script>
const output = document.getElementById('result');
const buttons = Array.from(document.querySelectorAll('button'));

async function call(url, method = 'GET') {
  const input = document.getElementById('key');
  const secret = input.value;

  if (method === 'POST') input.value = '';

  buttons.forEach(button => button.disabled = true);
  output.textContent = 'Contacting the server…';

  try {
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      headers: method === 'POST'
        ? { 'X-MPE-Admin-Key': secret }
        : {}
    });

    const data = await response.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    output.textContent = 'Connection error: ' + error.message;
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
}

document.getElementById('read').onclick =
  () => call('/api/memory/state');

document.getElementById('old').onclick =
  () => call('/api/test/marker');

document.getElementById('seed').onclick =
  () => call('/api/memory/initialize', 'POST');

document.getElementById('pulse').onclick =
  () => call('/api/memory/test-pulse', 'POST');

document.getElementById('concurrent').onclick =
  () => call('/api/memory/concurrency-test', 'POST');

for (const [id, endpoint] of [
  ['mpeInit', 'init'],
  ['mpeView', 'view'],
  ['mpeSim', 'simulate'],
  ['mpeAge', 'age']
]) {
  document.getElementById(id).onclick =
    () => call('/api/mpe05/' + endpoint, 'POST');
}
</script>
</body>
</html>`;

const offerRates = new Map();

const memoryPaths = new Set([
  '/api/memory/state',
  '/api/memory/initialize',
  '/api/memory/test-pulse',
  '/api/memory/concurrency-test'
]);

const server = http.createServer(async (req, res) => {
  let p;

  try {
    p = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return json(res, 400, { error: 'bad_path' });
  }

  if (
    req.method === 'GET' &&
    (p === '/health' || p === '/api/health')
  ) {
    return json(res, 200, {
      status: 'ok',
      version: '0.7.0',
      startedAt,
      storage: store.mode
    });
  }

  if (req.method === 'GET' && p === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'Content-Security-Policy':
        "default-src 'self'; script-src 'unsafe-inline'; " +
        "style-src 'unsafe-inline'; object-src 'none'; base-uri 'none'"
    });
    return res.end(page);
  }

  // Optional curated ghost photographs: read-only, exact filenames.
  if (req.method === 'GET' && (p === '/ghost/R0012371.jpeg' || p === '/ghost/R0011165.jpeg')) {
    const fs = require('node:fs');
    const file = require('node:path').join(__dirname, 'ghost', p.slice('/ghost/'.length));
    try {
      const bytes = fs.readFileSync(file);
      res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=3600' });
      return res.end(bytes);
    } catch { return json(res, 404, { error: 'ghost_unavailable' }); }
  }

  // Read-only public visual snapshot. No mutation or simulation.
  if (req.method === 'GET' && p === '/api/artwork/state') {
    try {
      const memory = await mpe05.read();
      if (!memory) return json(res, 503, { error: 'artwork_not_initialized' });
      return json(res, 200, mpe05.artworkState(memory));
    } catch (error) {
      console.error('Artwork snapshot:', error.code || error.message);
      return json(res, 503, { error: 'artwork_unavailable' });
    }
  }

  if (req.method === 'GET' && p === '/living-memory.html') {
    const fs = require('node:fs');
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'"
    });
    return res.end(fs.readFileSync(require('node:path').join(__dirname,'living-memory.html')));
  }


  if (req.method === 'POST' && p === '/api/offer') {
    if (!sameOrigin(req)) {
      return json(res, 403, { error: 'origin_rejected' });
    }

    const ip = req.socket.remoteAddress || 'unknown';
    const now = Date.now();

    const recent = (offerRates.get(ip) || [])
      .filter(t => now - t < 60000);

    if (recent.length >= 8) {
      return json(res, 429, { error: 'too_many_offers' });
    }

    let body = '';
    let tooLarge = false;

    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024) tooLarge = true;
    });

    req.on('end', async () => {
      if (tooLarge) {
        return json(res, 413, {
          error: 'request_too_large'
        });
      }

      let data;

      try {
        data = JSON.parse(body);
      } catch {
        return json(res, 400, {
          error: 'invalid_json'
        });
      }

      if (
        !data ||
        typeof data !== 'object' ||
        'text' in data ||
        'original' in data ||
        'raw' in data ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
          .test(data.id || '') ||
        !Array.isArray(data.features) ||
        data.features.length !== 8 ||
        !data.features.every(
          v => typeof v === 'number' &&
               Number.isFinite(v) &&
               v >= 0 && v <= 1
        )
      ) {
        return json(res, 400, {
          error: 'invalid_abstract_trace'
        });
      }

      recent.push(now);
      offerRates.set(ip, recent);

      try {
        const receipt = await mpe05.offer(
          data.features, data.id
        );

        return json(res, 202, {
          ...receipt,
          message: 'Its moment is yet to come.'
        });
      } catch (error) {
        console.error(
          'Offer failed:',
          error.code || error.message
        );

        return json(res, 503, {
          error: 'offer_unavailable'
        });
      }
    });

    return;
  }

  if (
    req.method === 'GET' &&
    p === '/leave-a-trace.html'
  ) {
    const fs = require('node:fs');

    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy':
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "connect-src 'self'; " +
        "img-src 'self' blob: data:; " +
        "object-src 'none'; base-uri 'none'"
    });

    return res.end(
      fs.readFileSync(
        require('node:path').join(
          __dirname, 'leave-a-trace.html'
        )
      )
    );
  }

  if (req.method === 'GET' && p === '/api/test/marker') {
    try {
      const marker = await oldMarker();

      return json(res, 200, {
        stored: !!marker,
        marker: marker?.marker || null,
        createdAt: marker?.created_at || null
      });
    } catch (error) {
      console.error('Marker lookup:', error.code || error.message);
      return json(res, 503, { error: 'marker_unavailable' });
    }
  }

  if (p.startsWith('/api/mpe05/')) {
    if (req.method !== 'POST') {
      return json(res, 405, {
        error: 'method_not_allowed'
      });
    }

    if (!sameOrigin(req)) {
      return json(res, 403, {
        error: 'origin_rejected'
      });
    }

    if (!authorized(req)) {
      return json(res, 401, {
        error: 'admin_key_required'
      });
    }

    try {
      const action = p.slice('/api/mpe05/'.length);
      let state;

      if (action === 'init') {
        state = await mpe05.initialize();
      } else if (action === 'view') {
        state = await mpe05.read();
      } else if (action === 'simulate') {
        state = await mpe05.change('simulate', 10);
      } else if (action === 'age') {
        state = await mpe05.change('age', 30);
      } else {
        return json(res, 404, {
          error: 'unknown_mpe_action'
        });
      }

      return json(res, 200, mpe05.summary(state));

    } catch (e) {
      console.error('MPE 0.5:', e.code || e.message);

      return json(res, 503, {
        error: 'mpe05_operation_failed'
      });
    }
  }

  if (memoryPaths.has(p)) {

    if (p === '/api/memory/state' && req.method === 'GET') {
      try {
        const state = await store.read();

        return json(res, 200, {
          initialized: !!state,
          storage: store.mode,
          state
        });
      } catch (error) {
        console.error('Memory read:', error.code || error.message);
        return json(res, 503, { error: 'memory_unavailable' });
      }
    }

    if (req.method !== 'POST' || p === '/api/memory/state') {
      return json(res, 405, { error: 'method_not_allowed' });
    }

    if (!sameOrigin(req)) {
      return json(res, 403, { error: 'origin_rejected' });
    }

    if (!authorized(req)) {
      return json(res, 401, { error: 'admin_key_required' });
    }

    try {
      if (p === '/api/memory/concurrency-test') {
        const report = await store.concurrencyTest(20);

        return json(res, report.passed ? 200 : 409, {
          storage: store.mode,
          report
        });
      }

      const state = p === '/api/memory/initialize'
        ? await store.initialize()
        : await store.testPulse();

      return json(res, 200, {
        initialized: true,
        storage: store.mode,
        state
      });

    } catch (error) {
      console.error('Memory write:', error.code || error.message);
      return json(res, 503, { error: 'memory_write_failed' });
    }
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('MPE engine integration test 0.5 on port ' + PORT);
});

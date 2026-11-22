
'use strict';

// A Memory Without an Owner — Production Experiment 0.4
// Portable persistence and protected concurrency test.
// Experimental only: no participant contributions are accepted.

const http = require('node:http');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');
const store = require('./memory-store');
const mpe05 = require('./mpe05');
const backup09 = require('./mpe09-backup');

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
<p class="lead">MPE Studio — Private Administration</p>
<section>
<p>Private memory diagnostics and research controls.
These functions are not part of the public artwork.</p>

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

<button id="retryTest">Test duplicate protection</button>
<button class="secondary" id="backup">Inspect memory snapshot</button>
<button id="backupDownload" class="secondary">
Download Memory Backup
</button>
<button id="restoreDrill">
Test Memory Restoration
</button>
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
      headers: secret
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

document.getElementById('retryTest').onclick =
  () => call('/api/admin/retry-test', 'POST');

document.getElementById('backup').onclick =
  () => call('/api/admin/backup', 'POST');

async function downloadMemoryBackup() {
  const key = document.getElementById('key');
  const secret = key.value;
  key.value = '';

  output.textContent = 'Preparing memory backup…';

  try {
    const response = await fetch('/api/admin/backup09', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'X-MPE-Admin-Key': secret }
    });

    if (!response.ok) {
      throw Error('HTTP ' + response.status);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download = 'MPE-memory-backup.json';
    document.body.append(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 10000);
    output.textContent = 'Backup download requested.';

  } catch (e) {
    output.textContent = 'Backup failed: ' + e.message;
  }
}

document.getElementById('backupDownload').onclick =
  downloadMemoryBackup;

document.getElementById('restoreDrill').onclick =
  () => call('/api/admin/restore09', 'POST');



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
      version: '1.0.0-beta.1',
      startedAt,
      storage: store.mode
    });
  }


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

    let input = '';
    let tooLarge = false;

    req.on('data', chunk => {
      if (tooLarge) return;
      if (Buffer.byteLength(input) + chunk.length > 1024) {
        tooLarge = true;
        return;
      }
      input += chunk.toString('utf8');
    });

    req.on('end', async () => {
      if (tooLarge) {
        return json(res, 413, {
          error: 'request_too_large'
        });
      }

      let data;

      try {
        data = JSON.parse(input);
      } catch {
        return json(res, 400, {
          error: 'invalid_json'
        });
      }

      if (
        !data ||
        typeof data !== 'object' ||
        Array.isArray(data) ||
        Object.keys(data).sort().join(',') !== 'features,id'
      ) {
        return json(res, 400, {
          error: 'invalid_abstract_trace'
        });
      }

      try {
        const result = await mpe05.offer(
          data.features, data.id
        );

        return json(res, 202, {
          ...result,
          message: 'Its moment is yet to come.'
        });

      } catch (error) {
        if (error.code === 'RATE_LIMIT') {
          return json(res, 429, {
            error: 'memory_is_resting'
          });
        }

        if (error.message === 'invalid_offer') {
          return json(res, 400, {
            error: 'invalid_abstract_trace'
          });
        }

        console.error(
          'MPE offer:',
          error.code || error.message
        );

        return json(res, 503, {
          error: 'offer_unavailable'
        });
      }
    });

    return;
  }


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



  if (
    req.method === 'POST' &&
    (p === '/api/admin/backup09' ||
     p === '/api/admin/restore09')
  ) {
    if (!sameOrigin(req) || !authorized(req)) {
      return json(res, 403, {
        error: 'access_denied'
      });
    }

    try {
      if (p === '/api/admin/restore09') {
        return json(
          res, 200,
          await backup09.restoreDrill()
        );
      }

      const snapshot = await backup09.takeSnapshot();
      const content = JSON.stringify(snapshot);

      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Disposition':
          'attachment; filename="MPE-memory-backup.json"',
        'X-Content-Type-Options': 'nosniff'
      });

      return res.end(content);

    } catch (error) {
      console.error(
        'MPE 0.9 backup:',
        error.code || error.message
      );

      return json(res, 503, {
        error: 'backup_or_restore_failed'
      });
    }
  }

  if (req.method === 'POST' &&
      p === '/api/admin/backup') {
    if (!sameOrigin(req) || !authorized(req)) {
      return json(res, 403, {
        error: 'access_denied'
      });
    }

    try {
      const state = await mpe05.read();

      return json(res, 200, {
        format: 'MPE-state-snapshot-v1',
        exportedAt: new Date().toISOString(),
        state
      });

    } catch (error) {
      return json(res, 503, {
        error: 'backup_unavailable'
      });
    }
  }

  if (req.method === 'POST' &&
      p === '/api/admin/retry-test') {
    if (!sameOrigin(req) || !authorized(req)) {
      return json(res, 403, {
        error: 'access_denied'
      });
    }

    try {
      const before = await mpe05.read();
      const id = crypto.randomUUID();
      const features = Array(8).fill(0.5);

      const first = await mpe05.offer(features, id);
      const second = await mpe05.offer(features, id);
      const after = await mpe05.read();

      return json(res, 200, {
        passed:
          after.offers - before.offers === 1 &&
          second.duplicate === true,
        beforeOffers: before.offers,
        afterOffers: after.offers,
        firstAccepted: first.accepted,
        secondWasDuplicate: second.duplicate
      });

    } catch (error) {
      return json(res, 503, {
        error: 'retry_test_failed'
      });
    }
  }

  if (req.method === 'GET' && p === '/api/test/marker') {
    if (!authorized(req)) {
      return json(res, 401, {
        error: 'admin_key_required'
      });
    }

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
      if (!authorized(req)) {
        return json(res, 401, {
          error: 'admin_key_required'
        });
      }

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


// Automatic memory clock.
// MySQL transaction locking prevents concurrent ticks
// and offerings from overwriting each other.

let clockRunning = false;

async function memoryClock() {
  if (clockRunning) return;
  clockRunning = true;

  try {
    await mpe05.tick();
  } catch (error) {
    console.error(
      'Memory clock:',
      error.code || error.message
    );
  } finally {
    clockRunning = false;
  }
}

setTimeout(memoryClock, 15000).unref();
setInterval(memoryClock, 60000).unref();

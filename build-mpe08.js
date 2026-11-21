
'use strict';

// MPE 0.8 — Production Hardening
// Installs durable MySQL receipts, rate limits,
// automatic memory evolution and admin snapshot export.
// Run once on the working MPE 0.7 checkout.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const names = ['mpe-core.js', 'mpe05.js', 'server.js'];
const source = Object.fromEntries(
  names.map(n => [n, fs.readFileSync(path.join(root, n), 'utf8')])
);

if (source['server.js'].includes('/api/admin/retry-test')) {
  throw Error('MPE 0.8 is already installed');
}

function replace(file, oldText, newText) {
  const content = source[file];

  if (
    !content.includes(oldText) ||
    content.indexOf(oldText) !== content.lastIndexOf(oldText)
  ) {
    throw Error('Source mismatch in ' + file);
  }

  source[file] = content.replace(oldText, newText);
}

// ------------------------------------------------
// 1. Allow the original engine to advance itself.
// ------------------------------------------------

replace(
  'mpe-core.js',
  `return {
  currentState,
  offer,
  simulate,`,
  `function tick() {
  evolve();
}

return {
  currentState,
  tick,
  offer,
  simulate,`
);

// ------------------------------------------------
// 2. Add ticking to existing atomic mutations.
// ------------------------------------------------

replace(
  'mpe05.js',
  `  } else if (action === 'simulate') {
    e.simulate(value);`,
  `  } else if (action === 'tick') {
    e.tick();
  } else if (action === 'simulate') {
    e.simulate(value);`
);

// ------------------------------------------------
// 3. Replace bounded request-ID memory with a
//    durable MySQL receipt ledger.
// ------------------------------------------------

const adapter = source['mpe05.js'];
const start = adapter.indexOf('async function offer(features, id) {');
const end = adapter.indexOf('\nmodule.exports = {', start);

if (start < 0 || end < 0) {
  throw Error('Cannot locate MPE 0.7 offer adapter');
}

const newOffer = `
async function receiptTables(db) {
  await db.query(\`
    CREATE TABLE IF NOT EXISTS mpe_offer_receipts (
      memory_id VARCHAR(64) NOT NULL,
      request_id CHAR(36) NOT NULL,
      accepted_at VARCHAR(30) NOT NULL,
      PRIMARY KEY(memory_id, request_id)
    )
  \`);

  await db.query(\`
    CREATE TABLE IF NOT EXISTS mpe_offer_rate (
      memory_id VARCHAR(64) NOT NULL,
      window_minute BIGINT NOT NULL,
      counter INT NOT NULL,
      PRIMARY KEY(memory_id, window_minute)
    )
  \`);
}

// At most 30 accepted offerings per minute for
// this whole experimental memory.
// This does not depend on reverse-proxy IP headers.

async function offer(features, id) {
  if (
    !Array.isArray(features) ||
    features.length !== 8 ||
    !features.every(v =>
      typeof v === 'number' &&
      Number.isFinite(v) &&
      v >= 0 && v <= 1
    ) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  ) {
    throw Error('invalid_offer');
  }

  // Development-only local storage.
  // For production/gallery multi-process storage,
  // SQLite or MySQL is required.

  if (!configured) {
    return serialized(async () => {
      const s = await localRead();

      if (!s) throw Error('not_initialized');

      const previous = s.acceptedRequests?.find(
        r => r.id === id
      );

      if (previous) {
        return {
          accepted: true,
          id,
          at: previous.at,
          duplicate: true
        };
      }

      const next = apply(s, 'offer', { features, id });
      await saveLocal(next);

      const receipt = next.acceptedRequests.find(
        r => r.id === id
      );

      return {
        accepted: true,
        id,
        at: receipt.at,
        duplicate: false
      };
    });
  }

  const db = await connect();

  try {
    await table(db);
    await receiptTables(db);
    await db.beginTransaction();

    // One lock protects the entire memory transition.
    const [rows] = await db.execute(
      'SELECT payload FROM mpe_memory_snapshots WHERE memory_id=? FOR UPDATE',
      [ID]
    );

    if (!rows.length) {
      throw Error('not_initialized');
    }

    const current = check(JSON.parse(rows[0].payload));

    // Return original result for repeat submissions.
    const [previous] = await db.execute(
      'SELECT accepted_at FROM mpe_offer_receipts WHERE memory_id=? AND request_id=?',
      [ID, id]
    );

    if (previous.length) {
      await db.commit();

      return {
        accepted: true,
        id,
        at: previous[0].accepted_at,
        duplicate: true
      };
    }

    // Acknowledge legacy 0.7 receipt IDs too.
    const legacy = current.acceptedRequests?.find(
      r => r.id === id
    );

    if (legacy) {
      await db.execute(
        'INSERT INTO mpe_offer_receipts (memory_id,request_id,accepted_at) VALUES (?,?,?)',
        [ID, id, legacy.at]
      );

      await db.commit();

      return {
        accepted: true,
        id,
        at: legacy.at,
        duplicate: true
      };
    }

    const minute = Math.floor(Date.now() / 60000);

    await db.execute(
      \`INSERT INTO mpe_offer_rate
       (memory_id,window_minute,counter)
       VALUES (?,?,1)
       ON DUPLICATE KEY UPDATE counter=counter+1\`,
      [ID, minute]
    );

    const [counts] = await db.execute(
      'SELECT counter FROM mpe_offer_rate WHERE memory_id=? AND window_minute=?',
      [ID, minute]
    );

    if (counts[0].counter > 30) {
      const error = Error('rate_limit');
      error.code = 'RATE_LIMIT';
      throw error;
    }

    const next = apply(
      current, 'offer', { features, id }
    );

    const stamp = new Date().toISOString();

    await db.execute(
      'UPDATE mpe_memory_snapshots SET revision=?,payload=? WHERE memory_id=?',
      [next.revision, JSON.stringify(next), ID]
    );

    await db.execute(
      'INSERT INTO mpe_offer_receipts (memory_id,request_id,accepted_at) VALUES (?,?,?)',
      [ID, id, stamp]
    );

    await db.commit();

    return {
      accepted: true,
      id,
      at: stamp,
      duplicate: false
    };

  } catch (error) {
    await db.rollback().catch(() => {});
    throw error;

  } finally {
    await db.end();
  }
}

// Advance simulated time with the existing,
// transaction-protected memory writer.

async function tick() {
  const current = await read();

  if (!current) return null;

  return change('tick');
}
`;

source['mpe05.js'] =
  adapter.slice(0, start) +
  newOffer +
  adapter.slice(end);

replace(
  'mpe05.js',
  `  artworkState,
  offer
};`,
  `  artworkState,
  offer,
  tick
};`
);

// ------------------------------------------------
// 4. Replace public submission handling.
// ------------------------------------------------

const originalServer = source['server.js'];

const routeStart = originalServer.indexOf(
  "  if (req.method === 'POST' && p === '/api/offer') {"
);

const routeEnd = originalServer.indexOf(
  "  if (\n    req.method === 'GET' &&\n    p === '/leave-a-trace.html'",
  routeStart
);

if (routeStart < 0 || routeEnd < 0) {
  throw Error('Cannot locate MPE 0.7 submission route');
}

const offerRoute = `
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

`;

source['server.js'] =
  originalServer.slice(0, routeStart) +
  offerRoute +
  originalServer.slice(routeEnd);

// ------------------------------------------------
// 5. Protected memory snapshot and retry test.
// ------------------------------------------------

const adminRoutes = `
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

`;

replace(
  'server.js',
  "  if (req.method === 'GET' && p === '/api/test/marker') {",
  adminRoutes +
  "  if (req.method === 'GET' && p === '/api/test/marker') {"
);

// Add two actions to the existing admin UI.

replace(
  'server.js',
  '<pre id="result">Ready.</pre>',
  `<button id="retryTest">Test duplicate protection</button>
<button class="secondary" id="backup">Inspect memory snapshot</button>
<pre id="result">Ready.</pre>`
);

replace(
  'server.js',
  `document.getElementById('concurrent').onclick =
  () => call('/api/memory/concurrency-test', 'POST');`,
  `document.getElementById('concurrent').onclick =
  () => call('/api/memory/concurrency-test', 'POST');

document.getElementById('retryTest').onclick =
  () => call('/api/admin/retry-test', 'POST');

document.getElementById('backup').onclick =
  () => call('/api/admin/backup', 'POST');`
);

replace(
  'server.js',
  "version: '0.7.0'",
  "version: '0.8.0'"
);

// A best-effort clock. Missed time is caught up on
// the next successful tick after a restart.

source['server.js'] += `

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
`;

// ------------------------------------------------
// 6. Validate scripts, then write safely.
// ------------------------------------------------

for (const name of names) {
  new vm.Script(source[name], {
    filename: name
  });
}

const htmlScript = source['server.js'].match(
  /<script>([\s\S]*?)<\/script>/
);

if (!htmlScript) {
  throw Error('Cannot validate admin UI');
}

new vm.Script(htmlScript[1], {
  filename: 'admin-interface'
});

for (const name of names) {
  fs.copyFileSync(
    path.join(root, name),
    path.join(root, name + '.before-mpe08')
  );
}

for (const name of names) {
  fs.writeFileSync(
    path.join(root, name),
    source[name]
  );
}

console.log('MPE 0.8 installed.');
console.log('Durable receipts enabled for MySQL.');
console.log('Automatic memory clock enabled.');
console.log('Admin backup and retry test added.');
console.log('Existing memory data untouched.');

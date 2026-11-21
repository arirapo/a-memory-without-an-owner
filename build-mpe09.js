
'use strict';

// MPE 0.9 — Memory Preservation & Recovery
// Install once in the MPE 0.8 production checkout.
// Never restores over the active memory.

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = __dirname;
const serverPath = path.join(root, 'server.js');
const backupPath = path.join(root, 'mpe09-backup.js');

if (fs.existsSync(backupPath)) {
  throw Error('MPE 0.9 already installed');
}

let server = fs.readFileSync(serverPath, 'utf8');

function replace(before, after) {
  if (
    !server.includes(before) ||
    server.indexOf(before) !== server.lastIndexOf(before)
  ) {
    throw Error('Unexpected server structure: ' + before.slice(0, 60));
  }
  server = server.replace(before, after);
}

const backup = String.raw`'use strict';

// MPE 0.9 — MySQL memory backup and recovery rehearsal.
// Does not modify the active memory.

const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const SOURCE = 'mpe-engine-preview-05';

async function connect() {
  for (const key of [
    'DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'
  ]) {
    if (!process.env[key]) {
      throw Error('Database configuration missing');
    }
  }

  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 6000
  });
}

function digest(payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(payload))
    .digest('hex');
}

function validateState(s) {
  if (
    !s || s.version !== 141 ||
    !Number.isSafeInteger(s.revision) ||
    !Array.isArray(s.nodes) ||
    !Array.isArray(s.deep) ||
    s.deep.length !== 2048 ||
    !Array.isArray(s.deepFossil) ||
    s.deepFossil.length !== 2048
  ) {
    throw Error('Invalid memory state');
  }
  return s;
}

async function takeSnapshot() {
  const db = await connect();

  try {
    await db.beginTransaction();

    // All memory-changing operations first lock this row.
    const [rows] = await db.execute(
      'SELECT revision,payload FROM mpe_memory_snapshots WHERE memory_id=? FOR UPDATE',
      [SOURCE]
    );

    if (rows.length !== 1) {
      throw Error('Source memory missing');
    }

    const state = validateState(
      JSON.parse(rows[0].payload)
    );

    const [receiptRows] = await db.execute(
      'SELECT request_id,accepted_at FROM mpe_offer_receipts WHERE memory_id=? ORDER BY request_id',
      [SOURCE]
    );

    const receipts = receiptRows.map(r => ({
      id: r.request_id,
      at: r.accepted_at
    }));

    const contents = {
      revision: Number(rows[0].revision),
      state,
      receipts
    };

    if (contents.revision !== state.revision) {
      throw Error('Revision mismatch');
    }

    await db.commit();

    return {
      format: 'MPE-backup-v1',
      sourceId: SOURCE,
      exportedAt: new Date().toISOString(),
      contents,
      sha256: digest(contents)
    };

  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;
  } finally {
    await db.end();
  }
}

async function restoreDrill() {
  // Snapshot the real memory first. The live state is read only.
  const backup = await takeSnapshot();
  const labId = 'mpe-recovery-' + crypto.randomUUID();

  let inserted = false;
  let passed = false;
  let verify = null;
  let cleanupSucceeded = false;

  try {
    const db = await connect();

    try {
      await db.beginTransaction();

      await db.execute(
        'INSERT INTO mpe_memory_snapshots (memory_id,revision,payload) VALUES (?,?,?)',
        [
          labId,
          backup.contents.revision,
          JSON.stringify(backup.contents.state)
        ]
      );

      for (const r of backup.contents.receipts) {
        await db.execute(
          'INSERT INTO mpe_offer_receipts (memory_id,request_id,accepted_at) VALUES (?,?,?)',
          [labId, r.id, r.at]
        );
      }

      await db.commit();
      inserted = true;
    } catch (e) {
      await db.rollback().catch(() => {});
      throw e;
    } finally {
      await db.end();
    }

    // Verify with a new connection after commit.
    const reader = await connect();

    try {
      const [rows] = await reader.execute(
        'SELECT revision,payload FROM mpe_memory_snapshots WHERE memory_id=?',
        [labId]
      );

      const [receiptRows] = await reader.execute(
        'SELECT request_id,accepted_at FROM mpe_offer_receipts WHERE memory_id=? ORDER BY request_id',
        [labId]
      );

      if (rows.length !== 1) {
        throw Error('Restored memory missing');
      }

      const state = validateState(
        JSON.parse(rows[0].payload)
      );

      const contents = {
        revision: Number(rows[0].revision),
        state,
        receipts: receiptRows.map(r => ({
          id: r.request_id,
          at: r.accepted_at
        }))
      };

      verify = digest(contents);
      passed = verify === backup.sha256;

    } finally {
      await reader.end();
    }

  } finally {
    // Cleanup touches only the uniquely named laboratory copy.
    // Do not leave persistent test memories in shared hosting.
    if (inserted) {
      const cleaner = await connect();

      try {
        await cleaner.beginTransaction();

        await cleaner.execute(
          'DELETE FROM mpe_offer_receipts WHERE memory_id=?',
          [labId]
        );

        await cleaner.execute(
          'DELETE FROM mpe_memory_snapshots WHERE memory_id=?',
          [labId]
        );

        await cleaner.commit();
        cleanupSucceeded = true;
      } catch (e) {
        await cleaner.rollback().catch(() => {});
        throw e;
      } finally {
        await cleaner.end();
      }
    }
  }

  return {
    passed: passed && cleanupSucceeded,
    revision: backup.contents.revision,
    offers: backup.contents.state.offers,
    receipts: backup.contents.receipts.length,
    sourceHash: backup.sha256,
    restoredHash: verify,
    cleanupSucceeded,
    sourceUnmodified: true,
    mode: 'isolated_mysql_restore_rehearsal'
  };
}

module.exports = {
  takeSnapshot,
  restoreDrill
};
`;

// Add the backup module to the server.
replace(
  "const mpe05 = require('./mpe05');",
  "const mpe05 = require('./mpe05');\n" +
  "const backup09 = require('./mpe09-backup');"
);

// Add admin interface controls.
replace(
  '<pre id="result">Ready.</pre>',
  `<button id="backupDownload" class="secondary">
Download Memory Backup
</button>
<button id="restoreDrill">
Test Memory Restoration
</button>
<pre id="result">Ready.</pre>`
);

// Add downloadable backup handling to browser JS.
const browserScript = `
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

`;

replace(
  "document.getElementById('backup').onclick =\n  () => call('/api/admin/backup', 'POST');",
  "document.getElementById('backup').onclick =\n  () => call('/api/admin/backup', 'POST');\n" +
  browserScript
);

// Add two admin-only endpoints.
const routes = `
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

`;

replace(
  "  if (req.method === 'POST' &&\n      p === '/api/admin/backup') {",
  routes +
  "  if (req.method === 'POST' &&\n      p === '/api/admin/backup') {"
);

replace(
  "version: '0.8.0'",
  "version: '0.9.0'"
);

// Verify JavaScript before writing.
new vm.Script(backup, { filename: 'mpe09-backup.js' });
new vm.Script(server, { filename: 'server.js' });

const browser = server.match(
  /<script>([\s\S]*?)<\/script>/
);

if (!browser) throw Error('Admin page script missing');

new vm.Script(browser[1], {
  filename: 'admin-browser-script'
});

// Save existing server and install the new files.
fs.copyFileSync(
  serverPath,
  serverPath + '.before-mpe09'
);

fs.writeFileSync(
  backupPath,
  backup,
  { flag: 'wx' }
);

fs.writeFileSync(serverPath, server);

console.log('Created mpe09-backup.js');
console.log('Updated server.js');
console.log('MPE 0.9 installed.');
console.log('Live memory was not modified.');

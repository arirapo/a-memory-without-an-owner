
'use strict';

// MPE Production Experiment 0.4
// Safe serialized memory updates.
//
// MySQL: database transaction + row lock.
// Local JSON: single-process update queue.
// Local JSON is for development, not multi-process hosting.

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const required = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD'
];

const useMysql = required.every(
  key => Boolean(process.env[key])
);

const anyMysql = [
  ...required,
  'DB_PORT'
].some(key => Boolean(process.env[key]));

if (anyMysql && !useMysql) {
  throw Error(
    'Incomplete DB configuration; refusing local fallback'
  );
}

const ID = 'preview-laboratory-v1';

const localPath = path.join(
  __dirname,
  'data',
  'memory-preview.json'
);

// Serializes local updates within one Node.js process.

let tail = Promise.resolve();

function serial(task) {
  const next = tail.then(task);

  tail = next.catch(() => {});

  return next;
}

function blank() {
  return {
    schemaVersion: 1,
    memoryId: ID,
    createdAt: new Date().toISOString(),
    revision: 0,
    testPulses: 0,
    notes: 'Infrastructure test only'
  };
}

function validate(state) {
  if (
    !state ||
    state.memoryId !== ID ||
    !Number.isSafeInteger(state.revision) ||
    !Number.isSafeInteger(state.testPulses) ||
    state.revision < 0 ||
    state.testPulses < 0
  ) {
    throw Error('Invalid stored memory');
  }

  return state;
}

async function connect() {
  const mysql = require('mysql2/promise');

  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 6000
  });
}

async function ensureTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS mpe_memory_snapshots (
      memory_id VARCHAR(64) PRIMARY KEY,
      revision BIGINT UNSIGNED NOT NULL,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    )
  `);
}

async function localRead() {
  try {
    return validate(
      JSON.parse(
        await fs.readFile(localPath, 'utf8')
      )
    );
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function atomicWrite(state, exclusive = false) {
  await fs.mkdir(
    path.dirname(localPath),
    { recursive: true }
  );

  if (exclusive) {
    try {
      await fs.writeFile(
        localPath,
        JSON.stringify(state, null, 2),
        { flag: 'wx' }
      );
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    return;
  }

  const tmp =
    localPath + '.' +
    process.pid + '.' +
    crypto.randomUUID() +
    '.tmp';

  try {
    await fs.writeFile(
      tmp,
      JSON.stringify(state, null, 2),
      { flag: 'wx' }
    );

    await fs.rename(tmp, localPath);

  } finally {
    await fs.rm(
      tmp,
      { force: true }
    ).catch(() => {});
  }
}

// Read without changing the memory.

async function read() {
  if (!useMysql) {
    return serial(localRead);
  }

  const db = await connect();

  try {
    await ensureTable(db);

    const [rows] = await db.execute(
      `SELECT payload
       FROM mpe_memory_snapshots
       WHERE memory_id = ?`,
      [ID]
    );

    return rows.length
      ? validate(JSON.parse(rows[0].payload))
      : null;

  } finally {
    await db.end();
  }
}

// Initialization does not replace existing memory.

async function initialize() {
  if (!useMysql) {
    return serial(async () => {
      const existing = await localRead();

      if (existing) return existing;

      await atomicWrite(blank(), true);

      return localRead();
    });
  }

  const db = await connect();

  try {
    await ensureTable(db);

    const seed = blank();

    await db.execute(
      `INSERT IGNORE INTO mpe_memory_snapshots
       (memory_id, revision, payload)
       VALUES (?, ?, ?)`,
      [ID, 0, JSON.stringify(seed)]
    );

    const [rows] = await db.execute(
      `SELECT payload
       FROM mpe_memory_snapshots
       WHERE memory_id = ?`,
      [ID]
    );

    return validate(
      JSON.parse(rows[0].payload)
    );

  } finally {
    await db.end();
  }
}

// Every change is calculated from the latest
// stored state while other writers are blocked.

async function atomicUpdate(mutator) {
  if (!useMysql) {
    return serial(async () => {
      const current = await localRead();

      if (!current) {
        throw Error('memory_not_initialized');
      }

      const next = mutator(
        structuredClone(current)
      );

      validate(next);

      if (next.revision !== current.revision + 1) {
        throw Error('revision_mismatch');
      }

      await atomicWrite(next);

      return next;
    });
  }

  const db = await connect();

  try {
    await ensureTable(db);

    await db.beginTransaction();

    const [rows] = await db.execute(
      `SELECT revision, payload
       FROM mpe_memory_snapshots
       WHERE memory_id = ?
       FOR UPDATE`,
      [ID]
    );

    if (!rows.length) {
      throw Error('memory_not_initialized');
    }

    const current = validate(
      JSON.parse(rows[0].payload)
    );

    const next = mutator(
      structuredClone(current)
    );

    validate(next);

    if (next.revision !== current.revision + 1) {
      throw Error('revision_mismatch');
    }

    await db.execute(
      `UPDATE mpe_memory_snapshots
       SET revision = ?, payload = ?
       WHERE memory_id = ?`,
      [
        next.revision,
        JSON.stringify(next),
        ID
      ]
    );

    await db.commit();

    return next;

  } catch (error) {
    try {
      await db.rollback();
    } catch {}

    throw error;

  } finally {
    await db.end();
  }
}

async function testPulse() {
  return atomicUpdate(state => {
    state.revision++;
    state.testPulses++;
    state.lastPulseAt = new Date().toISOString();

    return state;
  });
}

// Run up to 20 simultaneous test updates.
// Do not run alongside unrelated writes.

async function concurrencyTest(count = 20) {
  if (
    !Number.isInteger(count) ||
    count < 2 ||
    count > 20
  ) {
    throw Error('invalid_count');
  }

  const before = await read();

  if (!before) {
    throw Error('memory_not_initialized');
  }

  const results = await Promise.allSettled(
    Array.from(
      { length: count },
      () => testPulse()
    )
  );

  const after = await read();

  const succeeded = results.filter(
    result => result.status === 'fulfilled'
  ).length;

  return {
    attempted: count,
    succeeded,
    failed: count - succeeded,

    beforeRevision: before.revision,
    afterRevision: after.revision,

    beforePulses: before.testPulses,
    afterPulses: after.testPulses,

    passed:
      succeeded === count &&
      after.revision - before.revision === count &&
      after.testPulses - before.testPulses === count,

    warning:
      'Run only in a quiet test environment.'
  };
}

module.exports = {
  read,
  initialize,
  atomicUpdate,
  testPulse,
  concurrencyTest,
  mode: useMysql ? 'mysql' : 'local-json'
};

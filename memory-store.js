
'use strict';

// MPE Production Experiment 0.3
// Portable memory storage.
// MySQL on GoDaddy, JSON on local machines.

const fs = require('node:fs/promises');
const path = require('node:path');

const MYSQL_VARS = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD'
];

const anyMysqlVar = [
  ...MYSQL_VARS,
  'DB_PORT'
].some(key => Boolean(process.env[key]));

const useMysql = MYSQL_VARS.every(
  key => Boolean(process.env[key])
);

if (anyMysqlVar && !useMysql) {
  throw Error(
    'Incomplete DB configuration; no local fallback'
  );
}

const localPath = path.join(
  __dirname,
  'data',
  'memory-preview.json'
);

const ID = 'preview-laboratory-v1';

function blankMemory() {
  return {
    schemaVersion: 1,
    memoryId: ID,
    createdAt: new Date().toISOString(),
    revision: 0,
    testPulses: 0,
    notes: 'Infrastructure test only'
  };
}

async function mysqlConnection() {
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

async function read() {
  if (!useMysql) {
    try {
      return JSON.parse(
        await fs.readFile(localPath, 'utf8')
      );
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  const db = await mysqlConnection();

  try {
    await ensureTable(db);

    const [rows] = await db.execute(
      'SELECT payload FROM mpe_memory_snapshots WHERE memory_id = ?',
      [ID]
    );

    return rows.length
      ? JSON.parse(rows[0].payload)
      : null;

  } finally {
    await db.end();
  }
}

async function initialize() {
  if (!useMysql) {
    await fs.mkdir(
      path.dirname(localPath),
      { recursive: true }
    );

    const seed = blankMemory();

    try {
      await fs.writeFile(
        localPath,
        JSON.stringify(seed, null, 2),
        { flag: 'wx' }
      );
      return seed;

    } catch (error) {
      if (error.code === 'EEXIST') {
        return read();
      }
      throw error;
    }
  }

  const db = await mysqlConnection();

  try {
    await ensureTable(db);

    const seed = blankMemory();

    await db.execute(
      `INSERT IGNORE INTO mpe_memory_snapshots
       (memory_id, revision, payload)
       VALUES (?, ?, ?)`,
      [ID, 0, JSON.stringify(seed)]
    );

    const [rows] = await db.execute(
      'SELECT payload FROM mpe_memory_snapshots WHERE memory_id = ?',
      [ID]
    );

    return JSON.parse(rows[0].payload);

  } finally {
    await db.end();
  }
}

async function testPulse() {
  if (!useMysql) {
    const state = await initialize();

    state.revision++;
    state.testPulses++;
    state.lastPulseAt = new Date().toISOString();

    const tmp = localPath + '.tmp';

    await fs.writeFile(
      tmp,
      JSON.stringify(state, null, 2)
    );

    await fs.rename(tmp, localPath);

    return state;
  }

  const db = await mysqlConnection();

  try {
    await ensureTable(db);
    await db.beginTransaction();

    const [rows] = await db.execute(
      `SELECT payload
       FROM mpe_memory_snapshots
       WHERE memory_id = ?
       FOR UPDATE`,
      [ID]
    );

    if (!rows.length) {
      await db.rollback();
      throw Error('memory_not_initialized');
    }

    const state = JSON.parse(rows[0].payload);

    state.revision++;
    state.testPulses++;
    state.lastPulseAt = new Date().toISOString();

    await db.execute(
      `UPDATE mpe_memory_snapshots
       SET revision = ?, payload = ?
       WHERE memory_id = ?`,
      [
        state.revision,
        JSON.stringify(state),
        ID
      ]
    );

    await db.commit();
    return state;

  } catch (error) {
    try {
      await db.rollback();
    } catch {}

    throw error;

  } finally {
    await db.end();
  }
}

module.exports = {
  read,
  initialize,
  testPulse,
  mode: useMysql ? 'mysql' : 'local-json'
};

'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

const { createEngine } = require('./mpe-core');

const ID = 'mpe-engine-preview-05';

const file = path.join(
  __dirname,
  'data',
  'mpe05.json'
);

const names = [
  'DB_HOST',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD'
];

const configured = names.every(
  n => Boolean(process.env[n])
);

if (
  names.concat('DB_PORT').some(
    n => Boolean(process.env[n])
  ) && !configured
) {
  throw Error('Incomplete database configuration');
}

let queue = Promise.resolve();

function serialized(fn) {
  const p = queue.then(fn);
  queue = p.catch(() => {});
  return p;
}

function initState() {
  const s = createEngine().currentState();
  s.revision = 0;
  return s;
}

function check(s) {
  if (
    !s ||
    s.version !== 141 ||
    !Array.isArray(s.nodes) ||
    !Array.isArray(s.deep) ||
    s.deep.length !== 2048 ||
    !Array.isArray(s.deepFossil) ||
    s.deepFossil.length !== 2048 ||
    !Number.isSafeInteger(s.revision)
  ) {
    throw Error('invalid_engine_memory');
  }

  return s;
}

async function localRead() {
  try {
    return JSON.parse(
      await fs.readFile(file, 'utf8')
    );
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

async function saveLocal(s) {
  await fs.mkdir(
    path.dirname(file),
    { recursive: true }
  );

  const tmp = file + '.' +
    crypto.randomUUID() + '.tmp';

  try {
    await fs.writeFile(
      tmp,
      JSON.stringify(s),
      { flag: 'wx' }
    );

    await fs.rename(tmp, file);

  } finally {
    await fs.rm(
      tmp,
      { force: true }
    ).catch(() => {});
  }
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

async function table(db) {
  await db.query(
    `CREATE TABLE IF NOT EXISTS mpe_memory_snapshots (
      memory_id VARCHAR(64) PRIMARY KEY,
      revision BIGINT UNSIGNED NOT NULL,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    )`
  );
}

async function read() {
  if (!configured) {
    return serialized(async () => {
      const value = await localRead();
      return value ? check(value) : null;
    });
  }

  const db = await connect();

  try {
    await table(db);

    const [rows] = await db.execute(
      'SELECT payload FROM mpe_memory_snapshots WHERE memory_id=?',
      [ID]
    );

    return rows.length
      ? check(JSON.parse(rows[0].payload))
      : null;

  } finally {
    await db.end();
  }
}

async function initialize() {
  if (!configured) {
    return serialized(async () => {
      const existing = await localRead();

      if (existing) return check(existing);

      await fs.mkdir(
        path.dirname(file),
        { recursive: true }
      );

      try {
        await fs.writeFile(
          file,
          JSON.stringify(initState()),
          { flag: 'wx' }
        );
      } catch (e) {
        if (e.code !== 'EEXIST') throw e;
      }

      return check(await localRead());
    });
  }

  const db = await connect();

  try {
    await table(db);

    const fresh = initState();

    await db.execute(
      'INSERT IGNORE INTO mpe_memory_snapshots (memory_id,revision,payload) VALUES (?,?,?)',
      [ID, 0, JSON.stringify(fresh)]
    );

    const [rows] = await db.execute(
      'SELECT payload FROM mpe_memory_snapshots WHERE memory_id=?',
      [ID]
    );

    return check(JSON.parse(rows[0].payload));

  } finally {
    await db.end();
  }
}

function apply(s, action, value) {
  const e = createEngine(check(s));

  if (action === 'simulate') {
    e.simulate(value);
  } else if (action === 'age') {
    e.age(value);
  } else {
    throw Error('invalid_action');
  }

  const next = e.currentState();
  next.revision = s.revision + 1;

  return check(next);
}

async function change(action, value) {
  if (!configured) {
    return serialized(async () => {
      const current = await localRead();

      if (!current) throw Error('not_initialized');

      const next = apply(current, action, value);

      await saveLocal(next);
      return next;
    });
  }

  const db = await connect();

  try {
    await table(db);
    await db.beginTransaction();

    const [rows] = await db.execute(
      'SELECT payload FROM mpe_memory_snapshots WHERE memory_id=? FOR UPDATE',
      [ID]
    );

    if (!rows.length) {
      throw Error('not_initialized');
    }

    const current = check(
      JSON.parse(rows[0].payload)
    );

    const next = apply(current, action, value);

    await db.execute(
      'UPDATE mpe_memory_snapshots SET revision=?,payload=? WHERE memory_id=?',
      [
        next.revision,
        JSON.stringify(next),
        ID
      ]
    );

    await db.commit();
    return next;

  } catch (e) {
    await db.rollback().catch(() => {});
    throw e;

  } finally {
    await db.end();
  }
}

function summary(s) {
  if (!s) {
    return {
      initialized: false,
      storage: configured ? 'mysql' : 'local-json'
    };
  }

  const d = createEngine(check(s)).diagnostic();

  return {
    initialized: true,
    storage: configured ? 'mysql' : 'local-json',
    revision: s.revision,
    days: d.days,
    offers: d.offers,
    forgotten: d.forgotten,
    regenerations: d.regenerations,
    visible: d.visible,
    echoes: d.echoes,
    deepStats: d.deepStats,
    weather: d.weather
  };
}

// Presentation-only shape: never exposes stored raw input or administrative controls.
function artworkState(memory) {
  const d = createEngine(check(memory)).diagnostic();
  return {
    revision: memory.revision, days: d.days, offers: d.offers,
    forgotten: d.forgotten, regenerations: d.regenerations,
    echoes: d.echoes, weather: d.weather, nodes: d.nodes,
    field: d.field, deepField: d.deepField, deepStats: d.deepStats
  };
}

module.exports = {
  read,
  initialize,
  change,
  summary,
  artworkState
};

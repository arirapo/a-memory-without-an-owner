
'use strict';

// MPE Production Experiment 0.5
// Builds the portable engine from frozen MPE 1.3.1.
// Run once in the production repository on Mac Mini.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const root = __dirname;

const original = path.join(
  os.homedir(),
  'MPE/shared-memory/server141.js'
);

const source = fs.readFileSync(original, 'utf8');
const serverFile = path.join(root, 'server.js');
const server = fs.readFileSync(serverFile, 'utf8');

for (const name of ['mpe-core.js', 'mpe05.js']) {
  if (fs.existsSync(path.join(root, name))) {
    throw Error(name + ' exists: refusing overwrite');
  }
}

if (server.includes("require('./mpe05')")) {
  throw Error('MPE 0.5 is already installed');
}

function between(text, from, to) {
  const a = text.indexOf(from);
  const b = text.indexOf(to, a + from.length);

  if (a < 0 || b < 0 || b <= a) {
    throw Error('Unexpected research source: ' + from);
  }

  return text.slice(a, b);
}

if (
  !source.includes('version: 141,') ||
  !source.includes('deepFossil: emptyDeep()')
) {
  throw Error('Expected frozen MPE 1.3.1 research source');
}

// Extract the actual MPE algorithms.

let core = between(
  source,
  'const clamp =',
  'function authorized(req)'
);

const oldBootstrap = between(
  core,
  'let memory;',
  'function deepIndex('
);

core = core.replace(
  oldBootstrap,
  `let memory = initialState
    ? structuredClone(initialState)
    : initial();

  let dirty = false;

  function persist() {
    dirty = true;
  }

  `
);

// A diagnostic snapshot must not change stored memory.

core = core.replace(
  '  evolve();\n  const deep = deepStats();',
  '  const deep = deepStats();'
);

if (
  core.includes('fs.existsSync') ||
  core.includes('const DATA') ||
  !core.includes('function evolveDeepField')
) {
  throw Error('Engine extraction failed');
}

const coreText = `'use strict';

// Original MPE 1.3.1 algorithms.
// Extracted from the preserved research baseline.

const crypto = require('node:crypto');

function createEngine(initialState) {

${core}

function currentState() {
  return structuredClone(memory);
}

function simulate(count) {
  if (
    !Number.isInteger(count) ||
    count < 1 ||
    count > 100
  ) {
    throw Error('invalid_simulation_count');
  }

  for (let i = 0; i < count; i++) {
    submit(Array.from({ length: 8 }, random));
  }
}

function age(days) {
  if (
    !Number.isInteger(days) ||
    days < 1 ||
    days > 365
  ) {
    throw Error('invalid_days');
  }

  evolve();
  advance(days);
  memory.last = now();
}

return {
  currentState,
  simulate,
  age,
  diagnostic
};
}

module.exports = { createEngine };
`;

// Separate MySQL memory from all previous experiments.

const adapter = `'use strict';

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
    \`CREATE TABLE IF NOT EXISTS mpe_memory_snapshots (
      memory_id VARCHAR(64) PRIMARY KEY,
      revision BIGINT UNSIGNED NOT NULL,
      payload LONGTEXT NOT NULL,
      updated_at TIMESTAMP NOT NULL
        DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP
    )\`
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

module.exports = {
  read,
  initialize,
  change,
  summary
};
`;

// Add the new engine to the existing preview application.

if (
  !server.includes("const store = require('./memory-store');") ||
  !server.includes('  if (memoryPaths.has(p)) {') ||
  !server.includes('<pre id="result">Ready.</pre>')
) {
  throw Error('Unexpected Preview server structure');
}

let patched = server.replace(
  "const store = require('./memory-store');",
  "const store = require('./memory-store');\n" +
  "const mpe05 = require('./mpe05');"
);

patched = patched.replace(
  '<pre id="result">Ready.</pre>',
  `<p><strong>MPE 0.5 — isolated memory engine</strong></p>

<button id="mpeInit">Initialize MPE 0.5</button>
<button id="mpeView" class="secondary">Inspect MPE 0.5</button>
<button id="mpeSim">Simulate 10 traces</button>
<button id="mpeAge">Advance 30 days</button>

<pre id="result">Ready.</pre>`
);

patched = patched.replace(
  "document.getElementById('concurrent').onclick =\n" +
  "  () => call('/api/memory/concurrency-test', 'POST');",

  `document.getElementById('concurrent').onclick =
  () => call('/api/memory/concurrency-test', 'POST');

for (const [id, endpoint] of [
  ['mpeInit', 'init'],
  ['mpeView', 'view'],
  ['mpeSim', 'simulate'],
  ['mpeAge', 'age']
]) {
  document.getElementById(id).onclick =
    () => call('/api/mpe05/' + endpoint, 'POST');
}`
);

const route = `  if (p.startsWith('/api/mpe05/')) {
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

`;

patched = patched.replace(
  '  if (memoryPaths.has(p)) {',
  route + '  if (memoryPaths.has(p)) {'
);

patched = patched.replace(
  'Safe memory experiment 0.4',
  'Safe memory experiment 0.5'
);

patched = patched.replace(
  "version: '0.4.0'",
  "version: '0.5.0'"
);

patched = patched.replace(
  'MPE safe memory test 0.4',
  'MPE engine integration test 0.5'
);

// Verify all JavaScript before changing files.

if (
  !patched.includes("require('./mpe05')") ||
  !patched.includes('mpe05.summary(state)') ||
  !patched.includes("['mpeInit', 'init']")
) {
  throw Error('Preview server patch failed');
}

new vm.Script(coreText, { filename: 'mpe-core.js' });
new vm.Script(adapter, { filename: 'mpe05.js' });
new vm.Script(patched, { filename: 'server.js' });

// Only write after all checks have passed.

fs.writeFileSync(
  path.join(root, 'mpe-core.js'),
  coreText
);

fs.writeFileSync(
  path.join(root, 'mpe05.js'),
  adapter
);

const temp = serverFile + '.mpe05.tmp';

fs.writeFileSync(temp, patched);
fs.renameSync(temp, serverFile);

console.log('Created mpe-core.js');
console.log('Created mpe05.js');
console.log('Updated server.js');
console.log('MPE 0.5 build completed.');

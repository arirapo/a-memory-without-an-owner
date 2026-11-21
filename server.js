
'use strict';

// A Memory Without an Owner — Production Experiment 0.2
// An isolated, admin-protected persistence test.
// It does not write participant or MPE memory data.

const http = require('node:http');
const crypto = require('node:crypto');
const mysql = require('mysql2/promise');

const PORT = Number(process.env.PORT || 3000);
const startedAt = new Date().toISOString();
const ADMIN_KEY = process.env.MPE_ADMIN_KEY || '';

function configured() {
  return ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME']
    .every(name => Boolean(process.env[name]));
}

async function connection() {
  return mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    connectTimeout: 6000
  });
}

async function readMarker() {
  const db = await connection();
  try {
    const [rows] = await db.execute(
      'SELECT marker, created_at FROM mpe_deployment_test WHERE id = ?',
      ['first-memory']
    );
    return rows[0] || null;
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return null;
    throw error;
  } finally {
    await db.end();
  }
}

async function createMarker() {
  const db = await connection();
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS mpe_deployment_test (
        id VARCHAR(40) PRIMARY KEY,
        marker VARCHAR(80) NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await db.execute(
      'INSERT IGNORE INTO mpe_deployment_test (id, marker) VALUES (?, ?)',
      ['first-memory', crypto.randomUUID()]
    );

    const [rows] = await db.execute(
      'SELECT marker, created_at FROM mpe_deployment_test WHERE id = ?',
      ['first-memory']
    );
    return rows[0];
  } finally {
    await db.end();
  }
}

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(data));
}

function authorized(req) {
  const candidate = req.headers['x-mpe-admin-key'];
  if (ADMIN_KEY.length < 24 || typeof candidate !== 'string') return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(ADMIN_KEY);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function sameOrigin(req) {
  if (!req.headers.origin) return true;
  try {
    return new URL(req.headers.origin).host === req.headers.host;
  } catch {
    return false;
  }
}

const page = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>A Memory Without an Owner — Persistence</title>
<style>
:root{color-scheme:dark}
*{box-sizing:border-box}
body{
  background:#0b1119;
  color:#eee8df;
  font:15px/1.6 system-ui,sans-serif;
  margin:0;
  min-height:100vh;
  display:grid;
  place-items:center
}
main{width:min(90vw,760px);padding:36px 0}
small{color:#9db8bf;letter-spacing:.13em}
h1{font:normal clamp(38px,6vw,70px)/1.07 Georgia,serif}
.lead{font:italic 20px Georgia,serif;color:#e6be94}
section{
  border:1px solid #344754;
  border-radius:13px;
  background:#17222e;
  padding:20px;
  margin-top:34px
}
label{display:block;color:#aebdc5;font-size:13px}
input{
  background:#0c1924;
  border:1px solid #506b77;
  border-radius:7px;
  color:#eee8df;
  padding:12px;
  width:100%;
  margin:8px 0
}
button{
  background:#e6be94;
  border:0;
  border-radius:8px;
  color:#182730;
  font-weight:bold;
  padding:12px 16px;
  cursor:pointer;
  margin:7px 7px 7px 0
}
button.secondary{
  background:#293d48;
  color:#eee8df;
  border:1px solid #506b77
}
pre{
  white-space:pre-wrap;
  overflow-wrap:anywhere;
  color:#c9d4d8
}
</style></head><body><main>
<small>TRACES BETWEEN / A MEMORY WITHOUT AN OWNER</small>
<h1>The memory has a place to live.</h1>
<p class="lead">Persistence experiment 0.2</p>
<section>
<p>This private preview tests one database marker.
No participant memories are stored yet.</p>
<button class="secondary" id="read">Read stored marker</button>
<label for="key">Admin key (used only for this request; not saved)</label>
<input id="key" type="password" autocomplete="off" spellcheck="false">
<button id="write">Create marker once</button>
<pre id="result">Ready for the first experiment.</pre>
</section></main>
<script>
const output=document.getElementById('result');

async function call(url,opts={}){
  output.textContent='Contacting the memory…';
  try{
    const response=await fetch(url,{cache:'no-store',...opts});
    const payload=await response.json();
    output.textContent=JSON.stringify(payload,null,2);
  }catch(e){
    output.textContent='Connection error: '+e.message;
  }
}

document.getElementById('read').onclick=()=>
  call('/api/test/marker');

document.getElementById('write').onclick=()=>{
  const key=document.getElementById('key');
  const value=key.value;
  key.value='';

  call('/api/test/marker',{
    method:'POST',
    headers:{'X-MPE-Admin-Key':value}
  });
};
</script></body></html>`;

const server = http.createServer(async (req, res) => {
  let pathname;

  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return json(res, 400, { error: 'invalid_path' });
  }

  if (
    req.method === 'GET' &&
    (pathname === '/health' || pathname === '/api/health')
  ) {
    return json(res, 200, {
      status: 'ok',
      version: '0.2.0',
      startedAt
    });
  }

  if (req.method === 'GET' && pathname === '/') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    return res.end(page);
  }

  if (pathname === '/api/test/marker') {
    if (!configured()) {
      return json(res, 503, {
        error: 'database_not_configured'
      });
    }

    if (req.method !== 'GET' && req.method !== 'POST') {
      return json(res, 405, {
        error: 'method_not_allowed'
      });
    }

    if (req.method === 'POST') {
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
    }

    try {
      const marker = req.method === 'POST'
        ? await createMarker()
        : await readMarker();

      return json(res, 200, {
        database: 'connected',
        stored: !!marker,
        marker: marker?.marker || null,
        createdAt: marker?.created_at || null
      });

    } catch (error) {
      console.error(
        'Persistence test failed:',
        error.code || error.message
      );

      return json(res, 503, {
        error: 'database_operation_failed'
      });
    }
  }

  return json(res, 404, { error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Persistence experiment 0.2 listening on port ${PORT}`
  );
});

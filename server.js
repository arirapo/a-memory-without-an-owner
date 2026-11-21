
'use strict';

// A Memory Without an Owner
// Deployment Test 0.1
// No database or participant data is used yet.

const http = require('node:http');

const PORT = Number(process.env.PORT || 3000);
const HOST = '0.0.0.0';

const startedAt = new Date().toISOString();

const page = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport"
        content="width=device-width,initial-scale=1">

  <title>A Memory Without an Owner</title>

  <style>
    :root {
      color-scheme: dark;
    }

    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #0b1119;
      color: #eee8df;
      font-family: system-ui, sans-serif;
    }

    main {
      width: min(90vw, 750px);
    }

    small {
      color: #9db8bf;
      letter-spacing: .16em;
    }

    h1 {
      font: normal clamp(2.5rem, 6vw, 5rem)
            Georgia, serif;
      line-height: 1.06;
    }

    p {
      font: italic 1.2rem Georgia, serif;
      color: #e6be94;
    }

    footer {
      margin-top: 3rem;
      color: #a6b7c0;
      font-size: .85rem;
    }
  </style>
</head>

<body>
  <main>
    <small>
      TRACES BETWEEN /
      A MEMORY WITHOUT AN OWNER
    </small>

    <h1>The memory has a place to live.</h1>

    <p>A living artwork is being prepared.</p>

    <footer>
      Deployment test 0.1 —
      no shared memory connected yet.
    </footer>
  </main>
</body>
</html>`;

const server = http.createServer((req, res) => {
  let pathname;

  try {
    pathname = new URL(
      req.url,
      'http://localhost'
    ).pathname;
  } catch {
    res.writeHead(400);
    return res.end('Bad request');
  }

  if (
    req.method !== 'GET' &&
    req.method !== 'HEAD'
  ) {
    res.writeHead(405, {
      Allow: 'GET, HEAD'
    });

    return res.end();
  }

  // Health check for GoDaddy and monitoring.

  if (
    pathname === '/health' ||
    pathname === '/api/health'
  ) {
    res.writeHead(200, {
      'Content-Type':
        'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });

    const result = {
      status: 'ok',
      app: 'a-memory-without-an-owner',
      version: '0.1.0',
      startedAt
    };

    return res.end(
      req.method === 'HEAD'
        ? undefined
        : JSON.stringify(result)
    );
  }

  // Initial artwork landing page.

  if (
    pathname === '/' ||
    pathname === '/index.html'
  ) {
    res.writeHead(200, {
      'Content-Type':
        'text/html; charset=utf-8',
      'X-Content-Type-Options': 'nosniff'
    });

    return res.end(
      req.method === 'HEAD'
        ? undefined
        : page
    );
  }

  // All other paths.

  res.writeHead(404, {
    'Content-Type':
      'text/plain; charset=utf-8'
  });

  res.end(
    req.method === 'HEAD'
      ? undefined
      : 'Not found'
  );
});

server.listen(PORT, HOST, () => {
  console.log(
    'A Memory Without an Owner ' +
    `is listening on port ${PORT}`
  );
});

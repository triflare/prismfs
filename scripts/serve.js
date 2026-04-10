#!/usr/bin/env node

/**
 * Local preview server for rapid TurboWarp extension iteration.
 *
 * Serves the build/ directory over HTTP with CORS headers so TurboWarp
 * can load the extension directly from localhost, and spawns the build
 * watcher so every source change triggers an automatic rebuild.
 *
 * Usage:
 *   npm run serve
 *   PORT=8080 npm run serve
 */

import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILD_DIR = path.join(__dirname, '../build');
const HOST = '127.0.0.1';

const rawPort = process.env.PORT || '3000';
const PORT = parseInt(rawPort, 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  console.error(
    `[SERVE] Invalid PORT value: "${rawPort}". Must be an integer between 1 and 65535.`
  );
  process.exit(1);
}

const MIME_TYPES = {
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.html': 'text/html',
  '.css': 'text/css',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.txt': 'text/plain',
};

/**
 * Spawn the build watcher as a child process so source changes trigger
 * automatic rebuilds while the HTTP server is running.
 */
function startWatchBuild() {
  const buildScript = path.join(__dirname, 'build.js');
  const child = spawn(process.execPath, [buildScript, '--watch'], {
    stdio: 'inherit',
    env: process.env,
  });

  child.on('exit', code => {
    if (code !== null && code !== 0) {
      console.error(`[SERVE] Build process exited unexpectedly (code ${code})`);
    }
  });

  return child;
}

/**
 * Create an HTTP server that serves static files from the build directory.
 * All responses include CORS headers so TurboWarp can import the extension
 * from localhost without restrictions.
 */
function createServer() {
  return http.createServer((req, res) => {
    const isHead = req.method === 'HEAD';

    if (!isHead && req.method !== 'GET') {
      res.writeHead(405, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('Method Not Allowed');
      return;
    }

    // Strip leading slashes and query string; default to extension.js
    const urlPath = (req.url || '/').split('?')[0].replace(/^\/+/, '');
    const filePath = path.join(BUILD_DIR, urlPath || 'extension.js');

    // First-pass path traversal check against the raw joined path
    const buildDirWithSep = BUILD_DIR + path.sep;
    if (!filePath.startsWith(buildDirWithSep)) {
      res.writeHead(403, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('Forbidden');
      return;
    }

    // Resolve the canonical path BEFORE opening the file so that symlinks
    // pointing outside build/ are rejected without reading their target.
    let realFilePath;
    try {
      realFilePath = fs.realpathSync(filePath);
    } catch (_err) {
      res.writeHead(404, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('Not Found – run `npm run build` first if the build directory is empty.');
      return;
    }

    const realBuildDirWithSep = REAL_BUILD_DIR + path.sep;
    if (!realFilePath.startsWith(realBuildDirWithSep)) {
      res.writeHead(403, {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      });
      res.end('Forbidden');
      return;
    }

    const ext = path.extname(realFilePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Stat the file to get Content-Length and to reject directories (EISDIR/ENOTDIR)
    // before streaming, so those cases surface as 404 rather than 500.
    fs.stat(realFilePath, (statErr, stats) => {
      if (statErr) {
        const status = statErr.code === 'ENOENT' ? 404 : 500;
        res.writeHead(status, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(
          status === 404
            ? 'Not Found – run `npm run build` first if the build directory is empty.'
            : 'Internal Server Error'
        );
        return;
      }

      if (!stats.isFile()) {
        res.writeHead(404, {
          'Content-Type': 'text/plain',
          'Access-Control-Allow-Origin': '*',
        });
        res.end('Not Found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stats.size,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });

      // HEAD requests need the headers but not the body
      if (isHead) {
        res.end();
        return;
      }

      fs.createReadStream(realFilePath).pipe(res);
    });
  });
}

// Ensure the build directory exists before starting
if (!fs.existsSync(BUILD_DIR)) {
  fs.mkdirSync(BUILD_DIR, { recursive: true });
}

// Resolve the canonical (real) path of the build directory once at startup so
// that symlinks and case-folding on case-insensitive filesystems cannot be used
// to escape the directory.
const REAL_BUILD_DIR = fs.realpathSync(BUILD_DIR);

const buildProcess = startWatchBuild();
const server = createServer();

server.listen(PORT, HOST, () => {
  const addr = server.address();
  const actualPort = addr ? addr.port : PORT;
  const base = `http://${HOST}:${actualPort}`;
  console.log('');
  console.log(`[SERVE] Preview server listening at ${base}/`);
  console.log(`[SERVE] TurboWarp import URL  →  ${base}/extension.js`);
  console.log('[SERVE] Watching for source changes – every save triggers a rebuild.');
  console.log('[SERVE] Press Ctrl+C to stop.');
  console.log('');
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[SERVE] Port ${PORT} is already in use. Set a different port with PORT=<number> npm run serve`
    );
  } else {
    console.error('[SERVE] Server error:', err.message);
  }
  buildProcess.kill();
  process.exit(1);
});

// Graceful shutdown on Ctrl+C / SIGTERM
function shutdown() {
  console.log('\n[SERVE] Shutting down…');
  server.close(() => {
    buildProcess.kill();
    buildProcess.once('exit', () => process.exit(0));
    // Safety timeout in case the child does not exit promptly
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

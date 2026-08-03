#!/usr/bin/env node
// Minimal zero-dependency static server for local preview + screenshotting.
//   node serve.mjs [--port 3000] [--root .]
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve, normalize, sep } from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const PORT = Number(arg('port', process.env.PORT || 3000));
const ROOT = resolve(arg('root', '.'));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function resolveTarget(pathname) {
  // Contain every request inside ROOT.
  const decoded = decodeURIComponent(pathname.split('?')[0]);
  const candidate = normalize(join(ROOT, decoded));
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return null;

  try {
    const info = await stat(candidate);
    if (info.isDirectory()) {
      const index = join(candidate, 'index.html');
      await stat(index);
      return index;
    }
    return candidate;
  } catch {
    // Allow extensionless pretty URLs: /about -> /about.html
    if (!extname(candidate)) {
      try {
        await stat(candidate + '.html');
        return candidate + '.html';
      } catch { /* fall through */ }
      // Single-page fallback. The app owns routes like /company/1155-maybank
      // and /my/portfolio, which have no file behind them — without this a
      // refresh on any real route 404s and the router never gets to run.
      // Only extensionless paths fall back, so a genuinely missing asset still
      // 404s instead of being served an HTML page with the wrong MIME type.
      try {
        const spa = join(ROOT, 'index.html');
        await stat(spa);
        return spa;
      } catch { /* no app entry point */ }
    }
    return null;
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const file = await resolveTarget(url.pathname);

  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`404 Not Found: ${url.pathname}`);
    return;
  }

  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'content-length': body.length,
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(`500 ${err.message}`);
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — a dev server is probably already running. Reuse it.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`serving ${ROOT}`);
  console.log(`http://localhost:${PORT}`);
});

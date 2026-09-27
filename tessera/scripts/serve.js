// A tiny static server for local development and the end-to-end tests. It serves the
// whole site (the repo root) so /tessera/ resolves exactly as it does on GitHub Pages.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const port = Number(process.env.PORT || 4173);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.md': 'text/markdown; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.pdf': 'application/pdf' };

createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let file = join(root, p);
    if (!file.startsWith(root)) { res.writeHead(403); res.end(); return; }
    let st = await stat(file).catch(() => null);
    if (st && st.isDirectory()) {
      if (!p.endsWith('/')) { res.writeHead(301, { location: `${p}/` }); res.end(); return; }
      file = join(file, 'index.html');
      st = await stat(file).catch(() => null);
    }
    if (!st) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(file));
  } catch (e) {
    res.writeHead(500); res.end(String(e));
  }
}).listen(port, () => console.log(`Serving ${root} at http://localhost:${port}/tessera/`));

// A static file server for local development and the browser tests.
//   node tools/serve.mjs [port]
// Serves the repository root. For a machine that cannot reach the UI5 CDN
// it also serves local OpenUI5 resources/ trees:
//   UI5_RESOURCES=<dir>         under /ui5/local/resources/  (?ui5=local)
//   UI5_RESOURCES_<name>=<dir>  under /ui5/<name>/resources/ (?ui5=local:<name>)
// e.g. UI5_RESOURCES_171=… and ?ui5=local:171. A tree can be assembled from
// the @openui5/* npm packages of a release: each package's src/ into one
// folder.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.properties': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
};

function localTrees() {
  const trees = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'UI5_RESOURCES' && v) trees.local = resolve(v);
    else if (k.startsWith('UI5_RESOURCES_') && v) trees[k.slice('UI5_RESOURCES_'.length).toLowerCase()] = resolve(v);
  }
  return trees;
}

export function startServer(port = 0) {
  const trees = localTrees();
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let base = ROOT;
      let rel = decodeURIComponent(url.pathname);
      const m = /^\/ui5\/([\w.-]+)\/resources(\/.*)$/.exec(rel);
      if (m && trees[m[1]]) {
        base = trees[m[1]];
        rel = m[2];
      }
      let file = normalize(join(base, rel));
      // inside the folder, not one whose name merely starts the same
      // (/repo-backup next to /repo): the separator is part of the test
      if (file !== base && !file.startsWith(base.endsWith(sep) ? base : base + sep)) throw Object.assign(new Error('outside'), { code: 'ENOENT' });
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = await startServer(Number(process.argv[2] || 8080));
  console.log(`http://127.0.0.1:${server.address().port}/`);
}

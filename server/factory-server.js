import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createModelService } from './allur/service.js';
import { createAgentService } from './allur/agent-service.js';

const root = path.resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const simulation = await createModelService({ statePath: process.env.ALLUR_STATE_PATH || fileURLToPath(new URL('../data/allur-state.json', import.meta.url)), autoTick: process.env.ALLUR_AUTOPLAY !== '0' });
const agent = await createAgentService({ getModel: () => simulation.model, statePath: process.env.ALLUR_STATE_PATH || fileURLToPath(new URL('../data/allur-state.json', import.meta.url)) });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ ok: true, app: 'allur', stage: 'production-model', model: simulation.status() }));
    }
    if (await agent.handle(req, res, url)) return;
    if (await simulation.handle(req, res, url)) return;
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); return res.end(); }
    const pathname = decodeURIComponent(url.pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
    const type = types[path.extname(file)];
    if (!type || !(await stat(file)).isFile()) { res.writeHead(404); return res.end('Not found'); }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 400);
    res.end('Resource unavailable');
  }
});
const port = Number(process.env.PORT || 3280);
server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`Allur factory: http://localhost:${port}`));
let closing = false;
async function close() { if (closing) return; closing = true; await agent.close(); await simulation.close(); server.close(); }
process.on('SIGTERM', close);
process.on('SIGINT', close);

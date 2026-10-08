import { readFile, mkdir, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { FactoryModel } from './engine.js';
import { FACTORS, CASE_DATA, defaultConfig, getPath } from './config.js';
import { SCENARIOS } from './scenarios.js';
import { analyze, DEMOS } from './analysis.js';

export async function createModelService({ statePath = null, autoTick = true } = {}) {
  let model, restored = false, persistenceError = null, forecastPersistenceError = null, lastSavedAt = null, savedRevision = null;
  if (statePath) {
    try { model = new FactoryModel({ state: JSON.parse(await readFile(statePath, 'utf8')) }); restored = true; lastSavedAt = (await stat(statePath)).mtime.toISOString(); savedRevision = model.s.revision; }
    catch (error) { if (error.code !== 'ENOENT') throw new Error(`Cannot restore model state: ${error.message}`); }
  }
  model ||= new FactoryModel();
  if(autoTick){model.s.running=true;model.s.speed=1;}
  const clients = new Set(), forecasts = new Map(), workers = new Set();
  let closed = false, writing = Promise.resolve(), accumulator = 0, last = performance.now(), saveCounter = 0, jobSequence = 0;
  let forecastWriting = Promise.resolve();
  if (statePath) {
    try {
      const archive = JSON.parse(await readFile(statePath + '.forecasts.json', 'utf8'));
      jobSequence = archive.sequence || 0;
      for (const job of archive.jobs.slice(-8)) {
        if (job.status === 'running') { job.status = 'failed'; job.error = 'Сервер был перезапущен во время расчёта. Запустите сравнение повторно.'; }
        forecasts.set(job.id, job);
      }
    } catch (error) { if (error.code !== 'ENOENT') forecastPersistenceError = 'Не удалось прочитать архив расчётов: ' + error.message; }
  }
  function snapshot() {
    return { ...model.snapshot(), serverTime: new Date().toISOString(), persistence: { enabled: !!statePath, lastSavedAt, savedRevision, error: persistenceError, forecastError: forecastPersistenceError } };
  }
  function persistForecasts() {
    if (!statePath) return Promise.resolve();
    const data = JSON.stringify({ sequence: jobSequence, jobs: [...forecasts.values()] });
    forecastWriting = forecastWriting.catch(() => {}).then(async () => {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath + '.forecasts.tmp', data, { mode: 0o600 });
      await rename(statePath + '.forecasts.tmp', statePath + '.forecasts.json'); forecastPersistenceError = null;
    }).catch(error => { forecastPersistenceError = error.message; console.error('Allur forecast save failed:', error.message); });
    return forecastWriting;
  }
  function persist() {
    if (!statePath) return Promise.resolve();
    const data = JSON.stringify(model.exportState()), revision = model.s.revision;
    writing = writing.catch(() => {}).then(async () => {
      await mkdir(path.dirname(statePath), { recursive: true });
      await writeFile(statePath + '.tmp', data, { mode: 0o600 }); await rename(statePath + '.tmp', statePath); persistenceError = null; lastSavedAt = new Date().toISOString(); savedRevision = revision;
    }).catch(error => { persistenceError = error.message; console.error('Allur checkpoint failed:', error.message); });
    return writing;
  }
  function broadcast() {
    if (!clients.size) return;
    const body = `id: ${model.s.revision}\nevent: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const response of clients) { if (response.writableLength > 1024 * 1024) { response.destroy(); clients.delete(response); } else response.write(body); }
  }
  const timer = autoTick ? setInterval(() => {
    const now = performance.now(), delta = Math.min((now - last) / 1000, 2); last = now;
    if (model.s.running) { accumulator += delta; const seconds = Math.floor(accumulator); accumulator -= seconds; if (seconds) model.advance(seconds); }
    else accumulator = 0;
    broadcast(); if (++saveCounter >= 10) { saveCounter = 0; persist(); }
  }, 1000) : null;
  timer?.unref();
  function json(res, code, body) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(body)); }
  async function body(req) {
    let text = '', size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 65536) throw new Error('Request body exceeds 64 KiB'); text += chunk; }
    try { return JSON.parse(text || '{}'); } catch { throw new Error('Invalid JSON'); }
  }
  async function handle(req, res, url) {
    if (!url.pathname.startsWith('/api/')) return false;
    try {
      if (req.method === 'GET' && url.pathname === '/api/analysis') { json(res, 200, analyze(model.snapshot())); return true; }
      if (req.method === 'GET' && url.pathname.startsWith('/api/case/files/')) {
        const index = { brief: 0, data: 1 }[url.pathname.split('/').pop()];
        if (index === undefined) { json(res, 404, { error: 'Unknown case file' }); return true; }
        const name = CASE_DATA.files[index]; const data = await readFile(new URL('../../' + name, import.meta.url));
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}` }); res.end(data); return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') { json(res, 200, snapshot()); return true; }
      if (req.method === 'GET' && url.pathname === '/api/contract') { json(res, 200, JSON.parse(await readFile(new URL('./contract.json', import.meta.url), 'utf8'))); return true; }
      if (req.method === 'GET' && url.pathname === '/api/audit') { json(res, 200, { source: 'simulation', commands: model.s.audit }); return true; }
      if (req.method === 'GET' && url.pathname === '/api/model') {
        json(res, 200, { schemaVersion: 1, source: 'simulation', restored, persistence: { enabled: !!statePath, error: persistenceError }, factors: Object.entries(FACTORS).map(([key, factor]) => ({ key, ...factor, current: getPath(model.s.config, key), apply: /^(inventory\.|initialWip\.)|\.initial|sparesInitial/.test(key) ? 'reset' : 'live' })), caseData: CASE_DATA, defaults: defaultConfig(), scenarios: SCENARIOS, demos: DEMOS }); return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/events') {
        if (clients.size >= 50) { json(res, 503, { error: 'Too many event streams' }); return true; }
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`); clients.add(res); req.on('close', () => clients.delete(res)); return true;
      }
      if (req.method === 'GET' && url.pathname === '/api/scenarios/jobs') {
        json(res, 200, { jobs: [...forecasts.values()].reverse().map(({ result, ...job }) => ({ ...job, url: `/api/scenarios/jobs/${job.id}` })), error: forecastPersistenceError }); return true;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/api/scenarios/jobs/')) {
        const job = forecasts.get(url.pathname.split('/').pop()); json(res, job ? 200 : 404, job || { error: 'Unknown job' }); return true;
      }
      if (req.method === 'POST') {
        // Same-origin writes; command APIs are intentionally separate from static assets.
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) { json(res, 403, { error: 'Cross-origin commands are not allowed' }); return true; }
        if (!(req.headers['content-type'] || '').includes('application/json')) { json(res, 415, { error: 'Use application/json' }); return true; }
        const input = await body(req);
        if (url.pathname === '/api/actions') {
          if(autoTick && ['speed','step','pause'].includes(input.type))throw new Error('Завод работает автоматически в реальном времени. Перемотка и пауза отключены.');
          if (input.type === 'demo') {
            const demo = DEMOS.find(item => item.id === input.id); if (!demo) throw new Error('Unknown demo');
            const next = new FactoryModel({ seed: 4817, factors: demo.factors }); next.advance(demo.warmupSeconds);
            if (demo.command) next.action(demo.command); next.s.running = autoTick; next.s.revision = model.s.revision + 1;
            model = next; accumulator = 0;
          } else if (input.type === 'step') {
            if (model.s.running) throw new Error('Pause the model before manual stepping');
            if (!Number.isInteger(input.seconds) || input.seconds < 1 || input.seconds > 3600) throw new Error('Manual step must be 1..3600 seconds');
            model.advance(input.seconds);
          } else if (input.type === 'reset') {
            const next = new FactoryModel({ seed: input.seed ?? model.s.seed, factors: input.factors || {} });
            next.s.running = autoTick; next.s.revision = model.s.revision + 1; model = next; accumulator = 0;
          } else model.action(input);
          await persist(); broadcast(); json(res, 200, snapshot()); return true;
        }
        if (url.pathname === '/api/scenarios/compare') {
          if (workers.size >= 1) { json(res, 429, { error: 'A comparison is already running' }); return true; }
          const id = `scenario-${++jobSequence}`, job = { id, status: 'running', basedOnRevision: model.s.revision, createdAt: new Date().toISOString(), options: input };
          forecasts.set(id, job);
          while (forecasts.size > 8) forecasts.delete(forecasts.keys().next().value);
          const worker = new Worker(new URL('./forecast-worker.js', import.meta.url), { workerData: { state: model.exportState(), options: input }, resourceLimits: { maxOldGenerationSizeMb: 192 } });
          workers.add(worker);
          const timeout = setTimeout(() => { job.status = 'failed'; job.error = 'Comparison exceeded 90 seconds'; persistForecasts(); worker.terminate(); }, 90000);
          worker.on('message', message => { clearTimeout(timeout); if (message.error) { job.status = 'failed'; job.error = message.error; } else { job.status = 'completed'; job.result = message.result; } job.completedAt = new Date().toISOString(); persistForecasts(); });
          worker.on('error', error => { job.status = 'failed'; job.error = error.message; persistForecasts(); });
          worker.on('exit', code => { clearTimeout(timeout); workers.delete(worker); if (job.status === 'running') { job.status = 'failed'; job.error = closed ? 'Сервер перезапущен во время расчёта. Запустите сравнение повторно.' : `Worker exited (${code})`; persistForecasts(); } });
          await persistForecasts();
          json(res, 202, { ...job, url: `/api/scenarios/jobs/${id}` }); return true;
        }
      }
      json(res, 404, { error: 'Unknown API endpoint or method' }); return true;
    } catch (error) { if (!res.headersSent) json(res, 400, { error: error.message }); else res.end(); return true; }
  }
  return { handle, get model() { return model; }, async close() { closed = true; if (timer) clearInterval(timer); for (const client of clients) client.end(); await Promise.all([...workers].map(worker => worker.terminate())); await persist(); await persistForecasts(); }, status() { return { restored, persistenceError, forecastPersistenceError, closed }; } };
}

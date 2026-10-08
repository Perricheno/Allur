import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createModelService } from '../../server/allur/service.js';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'allur-model-test-'));
  const statePath = path.join(dir, 'state.json');
  const service = await createModelService({ statePath, autoTick: false });
  const server = http.createServer((req, res) => service.handle(req, res, new URL(req.url, 'http://localhost')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const get = async url => { const response = await fetch(base + url); return { status: response.status, data: await response.json() }; };
  const post = async (url, body, headers = {}) => { const response = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }); return { status: response.status, data: await response.json() }; };
  t.after(async () => { await service.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await rm(dir, { recursive: true }); });
  return { service, statePath, base, get, post };
}

test('API exposes contract and facts, validates mutations, and checkpoints without touching UI', async t => {
  const f = await fixture(t);
  const catalog = await f.get('/api/model'); assert.equal(catalog.status, 200); assert.ok(catalog.data.factors.length > 100);
  assert.equal((await f.get('/api/contract')).data.version, 1);
  assert.equal((await f.post('/api/actions', { type: 'step', seconds: 1 })).status, 400);
  await f.post('/api/actions', { type: 'pause' });
  const response = await f.post('/api/actions', { type: 'step', seconds: 600 });
  assert.equal(response.status, 200); assert.equal(response.data.clock.elapsedSeconds, 600);
  assert.equal(response.data.conservation.balanced, true);
  assert.equal((await f.post('/api/actions', { type: 'configure', factors: { 'utilities.powerLimitKw': -5 } })).status, 400);
  assert.equal((await f.post('/api/actions', { type: 'pause' }, { Origin: 'https://unrelated.example' })).status, 403);
  const saved = JSON.parse(await readFile(f.statePath, 'utf8')); assert.equal(saved.elapsed, 600);
  const restored = await createModelService({ statePath: f.statePath, autoTick: false });
  assert.equal(restored.status().restored, true); assert.deepEqual(restored.model.exportState(), f.service.model.exportState()); await restored.close();
  assert.ok((await f.get('/api/audit')).data.commands.length >= 1);
});

test('SSE returns a usable snapshot and scenario worker leaves the live state intact', async t => {
  const f = await fixture(t); await f.post('/api/actions', { type: 'pause' });
  const abort = new AbortController();
  const stream = await fetch(f.base + '/api/events', { signal: abort.signal });
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  const reader = stream.body.getReader(); const chunk = await reader.read();
  assert.match(new TextDecoder().decode(chunk.value), /event: state/); abort.abort();
  const before = f.service.model.exportState();
  const job = await f.post('/api/scenarios/compare', { variants: ['power-limit'], horizonSeconds: 3600, seeds: [42] });
  assert.equal(job.status, 202);
  let result;
  for (let i = 0; i < 100; i++) { result = await f.get(job.data.url); if (result.data.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.equal(result.data.status, 'completed', result.data.error);
  assert.equal(result.data.result.results.length, 2); assert.deepEqual(f.service.model.exportState(), before);
  const reset = await f.post('/api/actions', { type: 'reset', seed: 9, factors: { 'inventory.wheels': 0 } });
  assert.equal(reset.data.clock.running, false); assert.equal(reset.data.inventory.wheels, 0); assert.equal(reset.data.seed, 9);
});

test('case downloads, demo initialization and incident acknowledgment remain consistent', async t => {
  const f = await fixture(t);
  for (const id of ['brief', 'data']) {
    const r = await fetch(f.base + '/api/case/files/' + id);
    assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'application/pdf');
    assert.equal(Buffer.from(await r.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
  }
  assert.equal((await f.get('/api/case/files/unknown')).status, 404);
  const d = await f.post('/api/actions', { type: 'demo', id: 'cascade' });
  assert.equal(d.status, 200); assert.equal(d.data.clock.running, false); assert.equal(d.data.clock.elapsedSeconds, 3600);
  const incident = d.data.incidents.find(i => i.endedAt === null);
  assert.equal(d.data.areas.find(a => a.id === 'paint').status, 'down');
  const repair = d.data.areas.find(a => a.id === 'paint').condition.repair;
  const ack = await f.post('/api/actions', { type: 'acknowledge', incidentId: incident.id, note: 'Бригада уведомлена' });
  assert.equal(ack.status, 200); assert.equal(ack.data.incidents.find(i => i.id === incident.id).note, 'Бригада уведомлена');
  assert.deepEqual(ack.data.areas.find(a => a.id === 'paint').condition.repair, repair);
  assert.equal((await f.post('/api/actions', { type: 'acknowledge', incidentId: 'unknown' })).status, 400);
  await f.post('/api/actions', { type: 'step', seconds: 600 });
  const analysis = await f.get('/api/analysis'); assert.equal(analysis.status, 200);
  assert.ok(analysis.data.recommendations.some(r => r.area === 'paint' && r.priority === 'critical'));
  assert.equal(analysis.data.losses.find(l => l.area === 'paint').minutes.equipment, 10);
  const before = f.service.model.exportState();
  assert.equal((await f.post('/api/actions', { type: 'demo', id: 'unknown' })).status, 400);
  assert.deepEqual(f.service.model.exportState(), before);
});

test('saved forecasts and their IDs survive service restart together with model settings', async t => {
  const f = await fixture(t);
  await f.post('/api/actions', { type: 'speed', value: 1 });
  await f.post('/api/actions', { type: 'pause' });
  const state = await f.post('/api/actions', { type: 'configure', factors: { 'lines.assembly.staffAvailable': 20 } });
  assert.equal(state.data.persistence.enabled, true); assert.equal(state.data.persistence.savedRevision, state.data.revision);
  assert.ok(Math.abs(Date.parse(state.data.serverTime) - Date.now()) < 2000);
  const job = await f.post('/api/scenarios/compare', { variants: ['power-limit'], horizonSeconds: 600, seeds: [4] });
  let result;
  for (let i = 0; i < 100; i++) { result = await f.get(job.data.url); if (result.data.status !== 'running') break; await new Promise(resolve => setTimeout(resolve, 30)); }
  assert.equal(result.data.status, 'completed');
  await f.service.close();
  const restored = await createModelService({ statePath: f.statePath, autoTick: false });
  t.after(() => restored.close());
  assert.equal(restored.model.s.config.lines.assembly.staffAvailable, 20); assert.equal(restored.model.s.speed, 1);
  const server = http.createServer((req, res) => restored.handle(req, res, new URL(req.url, 'http://localhost')));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const saved = await (await fetch(base + job.data.url)).json();
  assert.deepEqual(saved.result, result.data.result);
  const archive = await (await fetch(base + '/api/scenarios/jobs')).json();
  assert.equal(archive.jobs[0].id, job.data.id); assert.equal(archive.jobs[0].status, 'completed');
  const next = await (await fetch(base + '/api/scenarios/compare', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variants: ['power-limit'], horizonSeconds: 60, seeds: [4] }) })).json();
  assert.notEqual(next.id, job.data.id);
});

test('real-time model advances without browser subscribers and pauses without stopping the real clock', async t => {
  const service = await createModelService({ autoTick: true }); t.after(() => service.close());
  assert.equal(service.model.s.speed, 1);
  const start = performance.now();
  while (service.model.s.elapsed < 2 && performance.now() - start < 5000) await new Promise(resolve => setTimeout(resolve, 100));
  assert.ok(service.model.s.elapsed >= 2); assert.ok(service.model.s.elapsed <= 4);
  service.model.action({ type: 'pause' }); const paused = service.model.s.elapsed;
  await new Promise(resolve => setTimeout(resolve, 1100)); assert.equal(service.model.s.elapsed, paused);
});

test('automatic service restores paused checkpoints at 1:1 and rejects public time manipulation',async t=>{
 const f=await fixture(t);await f.post('/api/actions',{type:'speed',value:600});await f.post('/api/actions',{type:'pause'});await f.service.close();
 const live=await createModelService({statePath:f.statePath,autoTick:true});assert.equal(live.model.s.running,true);assert.equal(live.model.s.speed,1);
 const server=http.createServer((req,res)=>live.handle(req,res,new URL(req.url,'http://localhost')));await new Promise(r=>server.listen(0,'127.0.0.1',r));
 t.after(async()=>{await live.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 for(const action of [{type:'speed',value:600},{type:'pause'},{type:'step',seconds:600}]){const r=await fetch(`http://127.0.0.1:${server.address().port}/api/actions`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(action)});assert.equal(r.status,400);}
 assert.equal(live.model.s.running,true);assert.equal(live.model.s.speed,1);
 const start=live.model.s.elapsed;await new Promise(r=>setTimeout(r,2100));assert.ok(live.model.s.elapsed>start&&live.model.s.elapsed<=start+3);
});

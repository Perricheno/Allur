import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { computationSnapshot } from '../public/js/computation-metrics.js';

export class Telemetry {
  constructor() {
    this.startedAt = Date.now(); this.operations = {}; this.writes = {}; this.requests = 0; this.responses = 0; this.httpErrors = 0; this.sentBytes = 0; this.activeRequests = 0;
    this.history = []; this.last = { at: performance.now(), cpu: process.cpuUsage(), bytes: 0, rows: 0, sent: 0, requests: 0, computations: 0 };
    this.loop = monitorEventLoopDelay({ resolution: 20 }); this.loop.enable(); this.latest = null;
  }
  measure(name, fn) {
    const start = performance.now(); let error = false;
    try { return fn(); } catch (e) { error = true; throw e; }
    finally {
      const ms = performance.now() - start, row = this.operations[name] ||= { count: 0, errors: 0, totalMs: 0, maxMs: 0, recent: [] };
      row.count++; row.errors += Number(error); row.totalMs += ms; row.maxMs = Math.max(row.maxMs, ms); row.recent.push(ms); if (row.recent.length > 120) row.recent.shift();
    }
  }
  write(name, bytes, records = 0) {
    const row = this.writes[name] ||= { writes: 0, bytes: 0, records: 0 };
    row.writes++; row.bytes += bytes; row.records += records;
  }
  request(req, res) {
    this.requests++; this.activeRequests++;
    let finished = false;
    const done = () => { if (finished) return; finished = true; this.activeRequests--; this.responses++; if (res.statusCode >= 400) this.httpErrors++; };
    res.once('finish', done); res.once('close', done);
    const size = (chunk, encoding) => typeof chunk === 'string' ? Buffer.byteLength(chunk, typeof encoding === 'string' ? encoding : undefined) : chunk?.byteLength || 0;
    const write = res.write, end = res.end, self = this;
    res.write = function(chunk, encoding, cb) { self.sentBytes += size(chunk, encoding); return write.call(this, chunk, encoding, cb); };
    res.end = function(chunk, encoding, cb) { self.sentBytes += size(chunk, encoding); return end.call(this, chunk, encoding, cb); };
  }
  sample({ files = [], archive, state, plan, streams = {}, push }) {
    const at = performance.now(), elapsed = Math.max(.001, (at - this.last.at) / 1000), cpu = process.cpuUsage();
    const writes = Object.values(this.writes), bytes = writes.reduce((n, r) => n + r.bytes, 0), rows = writes.reduce((n, r) => n + r.records, 0);
    const counters = computationSnapshot(), computations = Object.values(counters).reduce((a, b) => a + b, 0);
    const rates = { writeBytes: (bytes - this.last.bytes) / elapsed, records: (rows - this.last.rows) / elapsed, sentBytes: (this.sentBytes - this.last.sent) / elapsed,
      requests: (this.requests - this.last.requests) / elapsed, computations: (computations - this.last.computations) / elapsed };
    const cpuPct = ((cpu.user - this.last.cpu.user) + (cpu.system - this.last.cpu.system)) / (elapsed * 10000);
    this.last = { at, cpu, bytes, rows, sent: this.sentBytes, requests: this.requests, computations };
    const safeRead = (file, fn) => { try { return fn(readFileSync(file, 'utf8')); } catch { return null; } };
    let processes = null, descriptors = null;
    try { processes = readdirSync('/proc').filter(x => /^\d+$/.test(x)).length; descriptors = readdirSync('/proc/self/fd').length; } catch { /* unavailable off Linux */ }
    const threads = safeRead('/proc/self/status', s => Number(s.match(/^Threads:\s+(\d+)/m)?.[1]) || null);
    const resources = process.getActiveResourcesInfo().reduce((all, name) => { all[name] = (all[name] || 0) + 1; return all; }, {});
    const fileInfo = files.map(([name, file]) => { try { const st = statSync(file); return { name, bytes: st.size, modifiedAt: st.mtimeMs }; } catch { return { name, bytes: null, modifiedAt: null }; } });
    const loop = { meanMs: Number.isFinite(this.loop.mean) ? this.loop.mean / 1e6 : 0, p95Ms: this.loop.percentile(95) / 1e6, maxMs: this.loop.max / 1e6 }; this.loop.reset();
    this.history.push({ at: Date.now(), cpuPct, heap: process.memoryUsage().heapUsed, ...rates }); if (this.history.length > 120) this.history.shift();
    this.latest = { at: Date.now(), startedAt: this.startedAt, uptimeSec: process.uptime(), pid: process.pid, processes, threads, descriptors,
      memory: process.memoryUsage(), cpuPct, loop, resources, rates, files: fileInfo, writes: structuredClone(this.writes), counters,
      operations: Object.entries(this.operations).map(([name, r]) => ({ name, count: r.count, errors: r.errors, totalMs: r.totalMs, averageMs: r.totalMs / r.count, maxMs: r.maxMs, p95Ms: [...r.recent].sort((a,b)=>a-b)[Math.max(0,Math.ceil(r.recent.length*.95)-1)] || 0 })),
      http: { requests: this.requests, responses: this.responses, errors: this.httpErrors, active: this.activeRequests, sentBytes: this.sentBytes }, streams,
      archive: { records: archive?.events.length ?? 0, startedAt: archive?.startedAt ?? null, through: archive?.through ?? null, persisted: Boolean(archive?.file) },
      model: { now: state.now, running: state.running, speed: state.speed, trains: state.trains.length, groups: state.groups.length, incidents: state.incidents.length, revision: state.revision },
      plan: { revision: plan?.revision || 0, fleet: plan?.fleet.length || 0, rows: plan?.optimized.rows.length || 0, unassigned: plan?.optimized.unassigned || 0, executionEnabled: Boolean(plan?.executionEnabled) },
      push: push?.diagnostics() || null, history: [...this.history] };
    return this.latest;
  }
  close() { this.loop.disable(); }
}

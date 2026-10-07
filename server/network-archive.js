import { existsSync, readFileSync, mkdirSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { networkEvents } from '../public/js/network-sim.js';

// Append-only journal. Restart preserves both records and the start of the archive.
export class NetworkArchive {
  constructor({ sim, now, file = null, onWrite = () => {} }) {
    this.onWrite = onWrite;
    this.sim = sim; this.file = file; this.events = []; this.ids = new Set();
    this.startedAt = now - 86400000; this.through = this.startedAt;
    if (file && existsSync(file)) {
      const lines = readFileSync(file, 'utf8').trim().split('\n');
      for (let i = 0; i < lines.length; i++) {
        let row;
        try { row = JSON.parse(lines[i]); }
        catch (error) { throw new Error(`Повреждён архив сети, строка ${i + 1}: ${error.message}`); }
        if (row.meta) this.startedAt = row.startedAt;
        else if (!this.ids.has(row.id)) { this.events.push(row); this.ids.add(row.id); this.through = Math.max(this.through, row.at); }
      }
      this.through = Math.max(this.startedAt, ...this.events.slice(-1).map(e => e.at));
    } else if (file) {
      mkdirSync(path.dirname(file), { recursive: true });
      const body = JSON.stringify({ meta: true, version: 1, startedAt: this.startedAt }) + '\n';
      appendFileSync(file, body); this.onWrite(Buffer.byteLength(body), 0);
    }
    this.advance(now);
  }
  advance(now) {
    if (now < this.through) return [];
    const fresh = [];
    // Catch up in bounded daily chunks after downtime / a clock jump.
    for (let from = this.through; from <= now;) {
      const end = Math.min(now, from + 86400000);
      for (const e of networkEvents(this.sim, end, (end - from) / 60000 + 1).slice().reverse()) {
        if (e.at < this.startedAt || this.ids.has(e.id)) continue;
        fresh.push(e); this.ids.add(e.id);
      }
      if (end === now) break;
      from = end;
    }
    fresh.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    if (this.file && fresh.length) {
      try { const body = fresh.map(e => JSON.stringify(e)).join('\n') + '\n'; appendFileSync(this.file, body); this.onWrite(Buffer.byteLength(body), fresh.length); }
      catch (error) { for (const e of fresh) this.ids.delete(e.id); throw error; }
    }
    this.events.push(...fresh); this.through = now;
    return fresh;
  }
  snapshot(now) { return { startedAt: this.startedAt, through: this.through, events: this.events.filter(e => e.at <= now) }; }
}

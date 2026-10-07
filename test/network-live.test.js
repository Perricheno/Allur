import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepare, networkEvents, networkTrains, networkItinerary } from '../public/js/network-sim.js';
import { stationBoard } from '../public/js/network-detail-data.js';
import { NetworkArchive } from '../server/network-archive.js';

const data = JSON.parse(readFileSync(new URL('../public/data/kz-routes.json', import.meta.url)));
const sim = prepare(data), now = Date.parse('2026-10-02T07:00:00Z');

test('events become visible at the exact millisecond, without the five-second cache delay', () => {
  const events = networkEvents(sim, now, 60);
  const event = events.find(e => e.at % 5000 !== 0);
  assert.ok(event);
  assert.ok(!networkEvents(sim, event.at - 1, 60).some(e => e.id === event.id));
  assert.ok(networkEvents(sim, event.at, 60).some(e => e.id === event.id));
  assert.ok(networkEvents(sim, event.at + 1, 60).some(e => e.id === event.id));
  assert.ok(!networkEvents(sim, event.at - 1, 60).some(e => e.id === event.id), 'clock rewind hides future');
  assert.equal(new Set(events.map(e => e.id)).size, events.length);
});

test('event window expires exactly and cache is isolated per simulation', () => {
  const e = networkEvents(sim, now, 60).at(-1);
  assert.ok(!networkEvents(sim, e.at + 60001, 1).some(r => r.id === e.id));
  const other = prepare({ routes: [] });
  assert.deepEqual(networkEvents(other, now, 60), []);
});

test('itinerary matches current stopped position and departure time', () => {
  for (const t of networkTrains(sim, now).filter(t => t.stopped)) {
    const stops = networkItinerary(sim, t);
    const stop = stops.find(s => s.name === t.station && s.arrival <= now && s.departure >= now);
    assert.ok(stop, t.uid);
    assert.ok(Math.abs((stop.departure - now) / 60000 - t.restMin) <= .51);
    assert.equal(stops.at(-1).arrival, t.arrivesMs);
  }
});

test('station occupancy requires a named stop, never proximity alone', () => {
  const trains = networkTrains(sim, now), t = trains.find(t => t.stopped);
  const r = { routeId: t.routeId, name: t.station, km: t.dir === 'fwd' ? t.km : t.totalKm - t.km };
  assert.ok(stationBoard(sim, r, trains, now).present.some(p => p.t.uid === t.uid));
  const other = stationBoard(sim, { ...r, name: 'Другая станция' }, trains, now);
  assert.equal(other.present.length, 0);
  assert.ok(other.nearby.length > 0);
});

test('archive persists, deduplicates restart and catches up; rewind never exposes future', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'ktz-archive-test-')), 'events.jsonl');
  const a = new NetworkArchive({ sim, now, file });
  const before = a.events.length;
  assert.ok(before > 1000);
  a.advance(now + 60000);
  assert.ok(a.events.length > before);
  const b = new NetworkArchive({ sim, now: now + 60000, file });
  assert.equal(b.startedAt, a.startedAt);
  assert.deepEqual(b.events, a.events);
  assert.equal(b.advance(now + 60000).length, 0);
  assert.ok(b.snapshot(now).events.every(e => e.at <= now));
  assert.equal(new Set(b.events.map(e => e.id)).size, b.events.length);
});

test('every archived operation explains itself and benefit has a calculation', () => {
  for (const e of networkEvents(sim, now, 1440)) {
    assert.ok(e.explanation && e.station && e.uid && e.id);
    if (e.savedMin) assert.ok(e.calculation);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createECDH, randomBytes } from 'node:crypto';
import { JournalPush, validateSubscription, LivePushCursor } from '../server/push.js';
import { prepare, networkEvents } from '../public/js/network-sim.js';
import { readFileSync } from 'node:fs';
const ec = createECDH('prime256v1'); ec.generateKeys();
const sub = { endpoint: 'https://web.push.apple.com/test', keys: { auth: randomBytes(16).toString('base64url'), p256dh: ec.getPublicKey().toString('base64url') } };
test('live push resumes after clock rewind even when archive has already seen that period', () => {
  const sim=prepare(JSON.parse(readFileSync(new URL('../public/data/kz-routes.json',import.meta.url))));
  const now=Date.parse('2026-10-03T04:00:00Z'), cursor=new LivePushCursor(now);
  const events=cursor.advance(sim,now+60000);
  assert.deepEqual(events,networkEvents(sim,now+60000,1).filter(e=>e.at>now));
  assert.deepEqual(cursor.advance(sim,now+60000),[]);
  assert.deepEqual(cursor.advance(sim,now),[]);
  assert.deepEqual(cursor.advance(sim,now+60000),events);
  assert.ok(events.length>0);
});
test('push rejects arbitrary destinations and invalid subscription keys', () => {
  assert.throws(() => validateSubscription({ ...sub, endpoint: 'https://127.0.0.1/admin' }));
  assert.throws(() => validateSubscription({ ...sub, endpoint: 'https://web.push.apple.com.attacker.test/a' }));
  assert.throws(() => validateSubscription({ ...sub, keys: {} }));
  assert.equal(validateSubscription(sub).endpoint, sub.endpoint);
});
test('opt-in receives each new event individually, removing subscription stops sends', async () => {
  const sent = [], push = new JournalPush(null, { send: async (s, payload) => sent.push(JSON.parse(payload)) });
  push.enqueue([{ id: 'before', text: 'до подписки' }]); push.add(sub);
  push.enqueue([{ id: 'a', number: 1, text: 'a' }, { id: 'b', number: 2, text: 'b' }]);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(sent.map(e => e.id), ['a', 'b']);
  push.remove(sub); push.enqueue([{ id: 'c', text: 'c' }]);
  await new Promise(resolve => setImmediate(resolve)); assert.equal(sent.length, 2);
});
test('status distinguishes browser subscription, provider acceptance and display receipt', async () => {
  let payload;
  const push = new JournalPush(null, { send: async (_, body) => { payload = JSON.parse(body); } });
  assert.equal(push.status(sub).registered, false);
  push.add(sub); assert.equal(push.status(sub).registered, true);
  assert.equal((await push.test(sub)).accepted, true);
  assert.equal(push.diagnostics().accepted, 1); assert.equal(push.diagnostics().received, 0);
  assert.ok(push.receipt(payload.receipt)); assert.equal(push.receipt(payload.receipt), false);
  assert.equal(push.diagnostics().received, 1); assert.ok(push.status(sub).receivedAt);
  const publicData = JSON.stringify(push.diagnostics());
  assert.ok(!publicData.includes(sub.endpoint)); assert.ok(!publicData.includes(sub.keys.auth));
  await assert.rejects(push.test(sub), /30 секунд/);
});
test('failed sends expose safe reason and stale subscription is removed', async () => {
  const push = new JournalPush(null, { send: async () => { const e = new Error(sub.endpoint); e.statusCode = 410; throw e; } });
  push.add(sub);
  assert.equal((await push.test(sub)).accepted, false);
  assert.equal(push.status(sub).registered, false); assert.equal(push.diagnostics().expired, 1);
  assert.ok(!JSON.stringify(push.diagnostics()).includes('/test'));
});

import webpush from 'web-push';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { networkEvents } from '../public/js/network-sim.js';

// The append-only archive can be ahead of model time after a reset/rewind.
// Notify events crossed by the current clock, not only never-before archived IDs.
export class LivePushCursor {
  constructor(now) { this.through = now; }
  advance(sim, now) {
    const from = this.through; this.through = now;
    if (now <= from) return [];
    return networkEvents(sim, now, (now - from) / 60000).filter(e => e.at > from && e.at <= now);
  }
}

export function validateSubscription(sub) {
  const url = new URL(sub?.endpoint);
  const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'];
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !allowed.some(host => url.hostname === host || (host === 'web.push.apple.com' && url.hostname.endsWith('.' + host)))) throw new Error('Недопустимый push-сервис');
  if (sub.endpoint.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(sub.keys?.p256dh || '') || !/^[A-Za-z0-9_-]+$/.test(sub.keys?.auth || '') || Buffer.from(sub.keys.p256dh, 'base64url').length !== 65 || Buffer.from(sub.keys.auth, 'base64url').length !== 16) throw new Error('Некорректные ключи подписки');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

export class JournalPush {
  constructor(directory, { send = webpush.sendNotification.bind(webpush) } = {}) {
    this.file = directory ? path.join(directory, 'web-push-private.json') : null;
    this.data = this.file && existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { vapid: webpush.generateVAPIDKeys(), subscriptions: [] };
    this.send = send; this.queue = []; this.running = false; this.dropped = 0; this.failed = 0; this.delivered = 0;
    this.expired = 0; this.received = 0; this.lastError = null; this.lastAcceptedAt = null; this.lastReceivedAt = null;
    this.receipts = new Map(); this.statuses = new Map(); this.lastTest = new Map();
    this.save();
  }
  save() {
    if (!this.file) return;
    mkdirSync(path.dirname(this.file), { recursive: true });
    writeFileSync(`${this.file}.tmp`, JSON.stringify(this.data), { mode: 0o600 });
    renameSync(`${this.file}.tmp`, this.file);
  }
  add(raw) {
    const sub = validateSubscription(raw);
    const existing = this.data.subscriptions.find(s => s.endpoint === sub.endpoint);
    if (!existing && this.data.subscriptions.length >= 100) throw new Error('Лимит подписок исчерпан');
    if (existing) { existing.keys = sub.keys; } else this.data.subscriptions.push(sub);
    this.save();
  }
  owned(raw) {
    const sub = validateSubscription(raw);
    return this.data.subscriptions.find(s => s.endpoint === sub.endpoint && s.keys.auth === sub.keys.auth && s.keys.p256dh === sub.keys.p256dh);
  }
  status(raw) {
    const sub = validateSubscription(raw);
    return { registered: Boolean(this.owned(sub)), ...(this.statuses.get(sub.endpoint) || {}) };
  }
  diagnostics() {
    return { subscriptions: this.data.subscriptions.length, queued: this.queue.length, sending: this.running,
      accepted: this.delivered, failed: this.failed, expired: this.expired, dropped: this.dropped,
      received: this.received, lastError: this.lastError, lastAcceptedAt: this.lastAcceptedAt, lastReceivedAt: this.lastReceivedAt };
  }
  receipt(token) {
    const record = this.receipts.get(token);
    if (!record || Date.now() - record.at > 3600000) return false;
    this.receipts.delete(token); this.received++; this.lastReceivedAt = Date.now();
    const status = this.statuses.get(record.endpoint) || {};
    this.statuses.set(record.endpoint, { ...status, receivedAt: this.lastReceivedAt });
    return true;
  }
  async test(raw) {
    const sub = this.owned(raw);
    if (!sub) throw new Error('Подписка не найдена на сервере. Включите уведомления заново.');
    if (Date.now() - (this.lastTest.get(sub.endpoint) || 0) < 30000) throw new Error('Следующий тест доступен через 30 секунд.');
    this.lastTest.set(sub.endpoint, Date.now());
    return this.deliver({ sub, event: { id: `test:${Date.now()}`, text: 'Проверка доставки: уведомления КТЖ работают на этом устройстве.', at: Date.now() } });
  }
  async deliver({ event, sub }) {
    const token = randomBytes(24).toString('hex');
    for (const [key, value] of this.receipts) if (Date.now() - value.at > 3600000) this.receipts.delete(key);
    if (this.receipts.size >= 10000) this.receipts.delete(this.receipts.keys().next().value);
    this.receipts.set(token, { endpoint: sub.endpoint, at: Date.now() });
    try {
      await this.send(sub, JSON.stringify({ title: `КТЖ · ${event.number ? '№' + event.number : 'Модель'}`, body: event.text.slice(0, 650), id: event.id, at: event.at, receipt: token }), {
        vapidDetails: { subject: 'https://ktz.perricheno.com', ...this.data.vapid }, timeout: 8000, TTL: 3600,
        topic: createHash('sha256').update(event.id).digest('base64url').slice(0, 32),
      });
      this.delivered++; this.lastAcceptedAt = Date.now();
      this.statuses.set(sub.endpoint, { ...this.statuses.get(sub.endpoint), acceptedAt: this.lastAcceptedAt, error: null });
      return { accepted: true, message: 'Push-сервис принял сообщение. Это ещё не подтверждение показа на телефоне.' };
    } catch (error) {
      this.receipts.delete(token); this.failed++;
      const status = Number(error.statusCode) || null;
      const reason = [401, 403].includes(status) ? 'Push-сервис отклонил авторизацию: переподключите уведомления.'
        : [404, 410].includes(status) ? 'Подписка устарела: включите уведомления заново.'
        : status === 429 ? 'Push-сервис ограничил частоту сообщений.' : status ? `Ошибка push-сервиса HTTP ${status}.` : 'Нет ответа push-сервиса: проверьте соединение сервера.';
      this.lastError = { at: Date.now(), status, provider: new URL(sub.endpoint).hostname, reason };
      this.statuses.set(sub.endpoint, { ...this.statuses.get(sub.endpoint), error: reason, failedAt: Date.now() });
      if ([404, 410].includes(status)) { this.expired++; this.data.subscriptions = this.data.subscriptions.filter(s => s.endpoint !== sub.endpoint); this.save(); }
      return { accepted: false, message: reason };
    }
  }
  remove(raw) {
    const sub = validateSubscription(raw);
    this.data.subscriptions = this.data.subscriptions.filter(s => s.endpoint !== sub.endpoint || s.keys.auth !== sub.keys.auth);
    this.save();
  }
  enqueue(events) {
    for (const event of events) for (const sub of this.data.subscriptions) {
      if (this.queue.length >= 10000) { this.dropped++; continue; }
      this.queue.push({ event, sub, attempts: 0 });
    }
    void this.flush();
  }
  async flush() {
    if (this.running) return;
    this.running = true;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 4);
        await Promise.all(batch.map(async item => {
          const { event, sub } = item;
          if (!this.data.subscriptions.some(s => s.endpoint === sub.endpoint)) return;
          await this.deliver({ event, sub });
        }));
      }
    } finally { this.running = false; }
  }
}

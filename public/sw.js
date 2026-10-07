// Do not cache API, JS or HTML: operational data must never silently become stale.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let payload;
  try { payload = event.data.json(); } catch { payload = { title: 'КТЖ', body: 'Новая запись в журнале' }; }
  event.waitUntil(self.registration.showNotification(payload.title || 'КТЖ', {
    body: payload.body, icon: '/assets/ktz-emblem.png', badge: '/assets/ktz-emblem.png',
    tag: payload.id, timestamp: payload.at, data: { url: '/#/log', id: payload.id },
  }).then(async () => {
    if (payload.receipt) {
      try { await fetch('/api/push/receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: payload.receipt }) }); } catch { /* notification already displayed; receipt is best effort */ }
    }
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.length) { await windows[0].navigate('/#/log'); return windows[0].focus(); }
    return self.clients.openWindow('/#/log');
  })());
});

import { useEffect, useState } from 'preact/hooks';
import { html } from './lib.js';
import { Button, Dialog } from './ui.js';

export function InstallApp() {
  const [open, setOpen] = useState(false), [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [enabled, setEnabled] = useState(false), [prompt, setPrompt] = useState(null);
  const [delivery, setDelivery] = useState(null);
  const post = async (action, sub) => {
    const response = await fetch(`/api/push/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
    const body = await response.json(); if (!response.ok) throw new Error(body.error || 'Сервис уведомлений недоступен'); return body;
  };
  const inspect = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription();
    if (!sub) { setEnabled(false); setDelivery(null); return; }
    const status = await post('status', sub);
    setDelivery(status); setEnabled(status.registered && Notification.permission === 'granted');
    if (!status.registered) setMessage('Разрешение браузера есть, но сервер не зарегистрировал подписку. Нажмите «Включить каждое событие» для восстановления.');
  };
  useEffect(() => {
    const install = e => { e.preventDefault(); setPrompt(e); };
    window.addEventListener('beforeinstallprompt', install);
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(() => inspect()).catch(() => setMessage('Не удалось проверить подписку на сервере. Проверьте соединение.'));
    return () => window.removeEventListener('beforeinstallprompt', install);
  }, []);
  useEffect(() => { if (!open) return; void inspect().catch(e => setMessage(e.message)); const timer = setInterval(() => { void inspect().catch(e => setMessage(e.message)); }, 3000); return () => clearInterval(timer); }, [open]);
  const test = async () => {
    setBusy(true);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) throw new Error('Сначала включите уведомления.');
      const result = await post('test', sub); setMessage(result.message); await inspect();
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  const toggle = async () => {
    setBusy(true); setMessage('');
    try {
      if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) throw new Error('Для iPhone: Safari → Поделиться → На экран «Домой», затем откройте приложение с иконки. Требуется iOS 16.4 или новее.');
      // Permission request must run directly in the click handler on iOS.
      if (!enabled && await Notification.requestPermission() !== 'granted') throw new Error('Разрешение не выдано. Уведомления можно разрешить в настройках телефона.');
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (enabled && sub) {
        const res = await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
        if (!res.ok) throw new Error('Сервер не подтвердил отключение. Повторите.');
        await sub.unsubscribe(); setEnabled(false); setMessage('Уведомления выключены.');
      } else {
        const config = await (await fetch('/api/push/config')).json();
        if (!config.publicKey) throw new Error('Служба уведомлений недоступна.');
        const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        if (sub?.options?.applicationServerKey && !new Uint8Array(sub.options.applicationServerKey).every((v, i) => v === key[i])) { await sub.unsubscribe(); sub = null; }
        sub ||= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        const res = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(sub) });
        if (!res.ok) throw new Error((await res.json()).error);
        setEnabled(true); setMessage('Включено: каждое новое событие журнала. Старые записи не рассылаются.');
      }
    } catch (e) { setMessage(e.message); } finally { setBusy(false); }
  };
  return html`<${Button} size="sm" icon="smartphone" onClick=${() => setOpen(true)}>Установить / уведомления</${Button}>
    <${Dialog} id="install-app" open=${open} onClose=${() => setOpen(false)} title="КТЖ на главном экране">
      <img src="/assets/ktz-emblem.png" width="72" height="72" alt="Эмблема КТЖ" />
      <p>iPhone: откройте сайт в Safari → «Поделиться» → «На экран Домой» → «Добавить». Затем запускайте КТЖ с новой иконки.</p>
      <p>Android: меню браузера → «Установить приложение» или «Добавить на главный экран».</p>
      ${prompt && html`<${Button} onClick=${async () => { await prompt.prompt(); setPrompt(null); }}>Установить приложение</${Button}>`}
      <h3>Уведомления из журнала</h3><p>Режим «Каждое событие»: отправления, приёмы, смены бригад, задержки и неисправности. На всей сети сообщений много. Подписка общая для модели, включается только для этого устройства.</p>
      <${Button} pending=${busy} onClick=${toggle}>${enabled ? 'Выключить уведомления' : 'Включить каждое событие'}</${Button}>
      <${Button} disabled=${!enabled || busy} reason="Сначала включите уведомления и дождитесь регистрации на сервере" onClick=${test}>Тестовое уведомление</${Button}>
      <p>Разрешение устройства: ${typeof Notification === 'undefined' ? 'недоступно в этом браузере' : Notification.permission === 'granted' ? 'выдано' : Notification.permission === 'denied' ? 'запрещено' : 'ещё не запрошено'}. Подписка на сервере: ${delivery?.registered ? 'зарегистрирована' : 'не подтверждена'}.</p>
      ${delivery?.acceptedAt && html`<p>Последнее принято push-сервисом: ${new Date(delivery.acceptedAt).toLocaleTimeString('ru-RU')}.</p>`}
      ${delivery?.receivedAt && html`<p>Приложение подтвердило показ уведомления: ${new Date(delivery.receivedAt).toLocaleTimeString('ru-RU')}.</p>`}
      ${delivery?.error && html`<p class="bad">${delivery.error}</p>`}
      <p role="status">${message}</p><p class="muted">Доставка при закрытом приложении зависит от сети, разрешений и ограничений iOS/Android. Полная история всегда остаётся в журнале.</p>
    </${Dialog}>`;
}

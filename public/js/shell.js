import { useEffect, useRef, useState } from 'preact/hooks';
import { html, Icon } from './lib.js';

export function readPreference(key, fallback) {
  try { return JSON.parse(localStorage.getItem('allur.' + key)) ?? fallback; } catch { return fallback; }
}
export function savePreference(key, value) { try { localStorage.setItem('allur.' + key, JSON.stringify(value)); } catch {} }
export function factoryLink() {
  const saved = readPreference('factoryRoute', '/?mode=live');
  return typeof saved === 'string' && /^\/(?:\?mode=(?:live|demo))?(?:#\/factory(?:\/(?:supply|welding|paint|assembly|quality|finished))?)?$/.test(saved) ? saved : '/?mode=live';
}
const timeFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const dateFormat = new Intl.DateTimeFormat('ru-RU', { timeZone: 'Asia/Almaty', day: '2-digit', month: 'short' });
export function RealClock({ serverTime }) {
  const anchor = useRef({ date: Date.now(), at: performance.now() });
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const date = Date.parse(serverTime);
    if (Number.isFinite(date)) { anchor.current = { date, at: performance.now() }; setNow(date); }
  }, [serverTime]);
  useEffect(() => {
    const update = () => setNow(anchor.current.date + performance.now() - anchor.current.at);
    const timer = setInterval(update, 1000);
    document.addEventListener('visibilitychange', update);
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', update); };
  }, []);
  return html`<div class="real-clock"><time dateTime=${new Date(now).toISOString()} aria-label="Текущее время в Костанае">${timeFormat.format(now)}</time><span>${dateFormat.format(now)} · Костанай · UTC+5</span></div>`;
}
export function SaveStatus({ persistence, connection }) {
  const p = persistence;
  const error = p?.error || p?.forecastError;
  return html`<span class=${`save-status ${error ? 'save-error' : ''}`} role=${error ? 'alert' : undefined} title=${error || 'Состояние модели сохраняется на сервере после команд и каждые 10 секунд. Последние 8 сценарных расчётов — в архиве.'}><${Icon} name=${error ? 'circle-alert' : 'check'} size=${14}/>${connection !== 'connected' ? 'Нет связи · данные могут устареть' : error ? 'Ошибка сохранения · ' + error : p?.enabled ? p.lastSavedAt ? 'Сохранено · ' + timeFormat.format(new Date(p.lastSavedAt)) : 'Ожидаем автосохранение' : 'Сохранение недоступно'}</span>`;
}
export function MobileNav({ active = 'factory' }) {
  const [open, setOpen] = useState(false), box = useRef(null);
  useEffect(() => {
    const close = event => { if (event.type === 'keydown' ? event.key === 'Escape' : !box.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
  }, []);
  const links = [['factory','3D-завод','building-2',factoryLink()],['overview','Мониторинг','activity','/control.html#overview'],['incidents','Инциденты','circle-alert','/control.html#incidents'],['agent','DTAI','cpu','/ai.html']];
  return html`<nav ref=${box} class="mobile-nav" aria-label="Мобильная навигация">${links.map(([id,label,icon,url])=>html`<a key=${id} href=${url} class=${active===id?'active':''} aria-current=${active===id?'page':undefined} onClick=${event=>{setOpen(false);if(active==='factory'&&id==='factory'){event.preventDefault();document.querySelector('.factory-stage')?.scrollIntoView({behavior:'smooth'});}}}><${Icon} name=${icon} size=${20}/><span>${label}</span></a>`)}<button class=${open||['scenarios','factors','case'].includes(active)?'active':''} aria-expanded=${open} aria-controls="mobile-more" onClick=${()=>setOpen(!open)}><${Icon} name="menu" size=${20}/><span>Ещё</span></button>${open&&html`<div class="mobile-more" id="mobile-more"><a href="/control.html#scenarios" onClick=${()=>setOpen(false)}>Прогноз<${Icon} name="activity" size=${18}/></a><a href="/control.html#factors" onClick=${()=>setOpen(false)}>Параметры модели<${Icon} name="sliders-horizontal" size=${18}/></a><a href="/control.html#case" onClick=${()=>setOpen(false)}>Кейс и защита<${Icon} name="file-text" size=${18}/></a></div>`}</nav>`;
}

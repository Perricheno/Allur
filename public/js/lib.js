import { h } from 'preact';
import htm from 'htm';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { createMorph, canonicalD } from 'morphicons/dom';
import { icons } from './icons.js';

export const html = htm.bind(h);

const tz = 'Asia/Almaty';
const fmtTime = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, hour: '2-digit', minute: '2-digit' });
const fmtDate = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: 'numeric', month: 'long' });
const fmtShort = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, day: '2-digit', month: '2-digit' });

export const time = ms => fmtTime.format(ms);
export const dateLong = ms => fmtDate.format(ms);
export const dateShort = ms => fmtShort.format(ms);
export const atMinute = (state, minutes) => state.baseTime + minutes * 60000;
export const clockAt = (state, minutes) => time(atMinute(state, minutes));

/** «2 ч 05 мин», «45 мин», «—» для нечисел. */
export function duration(mins) {
  if (!Number.isFinite(mins)) return '—';
  const sign = mins < 0 ? '−' : '';
  const m = Math.round(Math.abs(mins));
  const hh = Math.floor(m / 60);
  const mm = m % 60;
  if (!hh) return `${sign}${mm} мин`;
  return `${sign}${hh} ч ${String(mm).padStart(2, '0')} мин`;
}
export const delayText = mins => (mins > 0 ? `+${mins} мин` : 'по графику');

export function plural(n, [one, few, many]) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  return b === 1 ? one : many;
}
export const count = (n, forms) => `${n} ${plural(n, forms)}`;

export const PRIORITY = {
  1: { short: 'Пассажирский', tone: 'accent' },
  2: { short: 'Транзит / контейнер', tone: 'ink' },
  3: { short: 'Сборный', tone: 'muted' },
};
export const DIRECTION = { even: 'Чётное', odd: 'Нечётное' };

const dCache = new Map();
const iconData = name => icons[name] || icons['circle-alert'];
const staticD = name => {
  if (!dCache.has(name)) dCache.set(name, canonicalD(iconData(name)));
  return dCache.get(name);
};

/** Иконка Lucide. При смене name плавно перетекает в новую (morphicons, пружинная анимация). */
export function Icon({ name, size = 18, class: cls = '', label, spring = 'snappy' }) {
  const path = useRef(null);
  const morph = useRef(null);
  const shown = useRef(name);
  useLayoutEffect(() => { path.current.setAttribute('d', staticD(shown.current)); }, []);
  useEffect(() => {
    if (shown.current === name) return;
    const from = shown.current;
    shown.current = name;
    if (!morph.current) morph.current = createMorph(path.current, iconData(from), { reducedMotion: 'user' });
    morph.current.morphTo(iconData(name), spring);
  }, [name]);
  useEffect(() => () => morph.current?.destroy(), []);
  return html`<svg class=${`icon ${cls}`} width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden=${label ? 'false' : 'true'}
    role=${label ? 'img' : undefined} aria-label=${label}><path ref=${path} /></svg>`;
}

export function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

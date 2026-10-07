import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { html, Icon } from './lib.js';
import { app, dismissToast } from './store.js';

/** Кнопка. Недоступная остаётся в фокусе и объясняет причину (aria-disabled + title). */
export function Button({ variant = 'secondary', size = 'md', icon, iconRight, children, onClick, disabled, reason, pending, label, class: cls = '', ...rest }) {
  const off = disabled || pending;
  const handle = e => { if (off) { e.preventDefault(); return; } onClick?.(e); };
  return html`<button type="button" class=${`btn btn-${variant} btn-${size} ${cls}`} aria-disabled=${off ? 'true' : undefined}
    title=${disabled && reason ? reason : rest.title} aria-label=${label} onClick=${handle} ...${rest}>
    ${(icon || pending) && html`<${Icon} name=${pending ? 'loader-circle' : icon} size=${size === 'sm' ? 15 : 17} class=${pending ? 'spin' : ''} />`}
    ${children != null && html`<span>${children}</span>`}
    ${iconRight && html`<${Icon} name=${iconRight} size=${size === 'sm' ? 15 : 17} />`}
    ${disabled && reason && html`<span class="sr-only">. ${reason}</span>`}
  </button>`;
}

export const Badge = ({ tone = 'neutral', icon, children, title }) =>
  html`<span class=${`badge badge-${tone}`} title=${title}>${icon && html`<${Icon} name=${icon} size=${13} />`}${children}</span>`;

/** Переключатель режимов (radiogroup со стрелками). */
export function Segmented({ value, options, onChange, label }) {
  const onKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (!step) return;
    e.preventDefault();
    const next = options[(i + step + options.length) % options.length];
    onChange(next.value);
    e.currentTarget.parentElement.querySelector(`[data-v="${next.value}"]`)?.focus();
  };
  return html`<div class="segmented" role="radiogroup" aria-label=${label}>
    ${options.map((o, i) => html`<button type="button" role="radio" data-v=${o.value} aria-checked=${value === o.value}
      tabindex=${value === o.value ? 0 : -1} class=${value === o.value ? 'on' : ''} onClick=${() => onChange(o.value)}
      onKeyDown=${e => onKey(e, i)}>${o.icon && html`<${Icon} name=${o.icon} size=${15} />`}${o.label}</button>`)}
  </div>`;
}

/** Вкладки со стрелками (WAI-ARIA tabs). */
export function Tabs({ value, tabs, onChange, label, idPrefix = 'tab' }) {
  const onKey = (e, i) => {
    const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (!step && e.key !== 'Home' && e.key !== 'End') return;
    e.preventDefault();
    const idx = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + step + tabs.length) % tabs.length;
    onChange(tabs[idx].value);
    document.getElementById(`${idPrefix}-${tabs[idx].value}`)?.focus();
  };
  return html`<div class="tabs" role="tablist" aria-label=${label}>
    ${tabs.map((t, i) => html`<button type="button" role="tab" id=${`${idPrefix}-${t.value}`} aria-selected=${value === t.value}
      aria-controls=${`${idPrefix}-panel`} tabindex=${value === t.value ? 0 : -1} class=${value === t.value ? 'on' : ''}
      onClick=${() => onChange(t.value)} onKeyDown=${e => onKey(e, i)}>${t.label}${t.count != null && html`<span class="tab-count">${t.count}</span>`}</button>`)}
  </div>`;
}

export function Dialog({ id = 'dialog', open, onClose, title, children, actions }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return html`<dialog id=${id} ref=${ref} class="dialog" aria-labelledby=${`${id}-title`} onCancel=${e => { e.preventDefault(); onClose(); }} onKeyDown=${e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }} onClick=${e => { if (e.target === ref.current) onClose(); }}>
    <div class="dialog-body">
      <div class="dialog-head"><h2 id=${`${id}-title`}>${title}</h2><${Button} variant="ghost" size="sm" icon="x" label="Закрыть" onClick=${onClose} /></div>
      <div class="dialog-content">${children}</div>
      ${actions && html`<div class="dialog-actions">${actions}</div>`}
    </div>
  </dialog>`;
}

export function Toasts() {
  return html`<div class="toasts" role="status" aria-live="polite">
    ${app.toasts.map(t => html`<div class=${`toast toast-${t.kind}`} key=${t.id}>
      <${Icon} name=${t.kind === 'error' ? 'circle-alert' : 'circle-check'} size=${18} />
      <p>${t.text}</p>
      <${Button} variant="ghost" size="sm" icon="x" label="Скрыть уведомление" onClick=${() => dismissToast(t.id)} />
    </div>`)}
  </div>`;
}

export const Kpi = ({ label, value, unit, note, tone, icon }) => html`<article class=${`kpi kpi-${tone || 'neutral'}`}>
  <div class="kpi-head"><span>${label}</span>${icon && html`<${Icon} name=${icon} size=${17} />`}</div>
  <div class="kpi-value">${value}${unit && html`<span class="kpi-unit">${unit}</span>`}</div>
  ${note && html`<div class="kpi-note">${note}</div>`}
</article>`;

export const Empty = ({ icon = 'circle-check', title, children }) => html`<div class="empty">
  <${Icon} name=${icon} size=${28} /><h3>${title}</h3>${children && html`<p>${children}</p>`}</div>`;

export const PageHeader = ({ title, subtitle, actions, crumbs }) => html`<header class="page-head">
  <div>
    ${crumbs && html`<nav class="crumbs" aria-label="Навигация">${crumbs.map((c, i) => html`${i > 0 && html`<${Icon} name="chevron-right" size=${13} />`}${c.href ? html`<a href=${c.href}>${c.label}</a>` : html`<span aria-current="page">${c.label}</span>`}`)}</nav>`}
    <h1>${title}</h1>${subtitle && html`<p class="subtitle">${subtitle}</p>`}
  </div>
  ${actions && html`<div class="page-actions">${actions}</div>`}
</header>`;

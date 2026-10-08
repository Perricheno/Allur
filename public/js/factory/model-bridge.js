import { useEffect, useState } from 'preact/hooks';
import { html } from '../lib.js';
import { createAllurModelClient } from '../allur-model-client.js';
import { STATUS, reasonText, percent, num } from '../control/common.js';
import { RealClock, SaveStatus } from '../shell.js';
import { AreaDetail } from '../area-detail.js';
const client = createAllurModelClient();
export function useProduction(engine, ready, live) {
  const [state,setState]=useState(null),[connection,setConnection]=useState('connecting'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let alive=true;const accept=value=>{if(alive)setState(previous=>!previous||value.revision>=previous.revision?value:previous);};const stop=client.subscribe(accept,value=>{if(alive)setConnection(value);});client.state().then(accept).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;stop();};},[]);
  useEffect(()=>{engine.current?.setProduction(live&&state?connection==='connected'?state:{...state,clock:{...state.clock,running:false}}:null);},[live,state,ready,connection]);
  async function command(value){setBusy(true);setError('');try{const next=await client.command(value);setState(previous=>!previous||next.revision>=previous.revision?next:previous);}catch(e){setError(e.message);}finally{setBusy(false);}}
  return {state,connection,error,busy,command};
}
export function ModelBar({live,onChange,production:p}) {
  return html`<div class="model-bridge-bar"><${RealClock} serverTime=${p.state?.serverTime}/><div class="factory-quick-links"><a href="/control.html#overview">Центр управления ↗</a><a href="/ai.html">DTAI · агент ↗</a></div><div class="bridge-mode"><label><input type="checkbox" checked=${live} onChange=${e=>{onChange(e.target.checked);const url=new URL(location.href);if(e.target.checked)url.searchParams.set('mode','live');else url.searchParams.set('mode','demo');history.replaceState(null,'',url);}}/>Состояние модели в 3D</label><span>${live?p.connection==='connected'?'Синхронизация с расчётами':p.state?'Связь потеряна · последнее состояние':'Подключаемся к модели…':'Демонстрация технологических операций'}</span></div>${live&&p.state&&html`<div class="bridge-controls"><strong>Расчёт · ${new Date(p.state.clock.iso).toLocaleTimeString('ru-RU',{timeZone:'Asia/Almaty',hour:'2-digit',minute:'2-digit',second:'2-digit'})}</strong><span class="realtime-label">Реальное время · автоматически</span></div>`}<${SaveStatus} persistence=${p.state?.persistence} connection=${p.connection}/>${p.error&&html`<span role="alert">${p.error}</span>`}</div>`;
}
export function LiveArea({state,selected,live}) {
  if(!live||!state)return null;
  if(selected)return html`<div class="live-area-card detailed"><${AreaDetail} state=${state} selected=${selected}/></div>`;
  return html`<section class="live-area-card"><h3>${state.totals.produced} автомобилей выпущено</h3><p>${state.kpis.wip} в производстве · ${state.totals.shipped} отгружено. Выберите участок для подробной информации.</p></section>`;
}

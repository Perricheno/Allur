import { render } from 'preact';
import { html } from '../lib.js';
import { useJob,usePlayback } from './client.js';
import { FactoryLab } from './lab.js';
import { Results } from './charts.js';
function App(){const id=new URLSearchParams(location.search).get('run'),{job,error}=useJob(id),playback=usePlayback(job);return html`<main class="standalone-main"><header><a href=${id?'/ai.html?run='+id:'/ai.html'}>← Allur DTAI</a><span>Наблюдение за сценарием</span></header>${error&&html`<p role="alert">${error}</p>`}<${FactoryLab} job=${job} playback=${playback} standalone/><${Results} job=${job} onSeek=${playback.seek}/></main>`;}
const root=document.getElementById('root');root.replaceChildren();render(html`<${App}/>`,root);

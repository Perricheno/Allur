import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createModelService } from '../../server/allur/service.js';
import { createAgentService } from '../../server/allur/agent-service.js';
const simulation=await createModelService({autoTick:false});
simulation.model.action({type:'configure',factors:{'maintenance.breakdownsEnabled':0}});
const plan={title:'Остановка окраски',hypothesis:'Проверяем последствия остановки для сборки',horizonHours:1,assumptions:['Остановка начинается сразу.'],parameters:[{key:'lines.assembly.staffAvailable',operation:'add',value:8}],stops:[{area:'paint',afterMinutes:0,durationMinutes:40,kind:'failure'}],deliveries:[]};
const agent=await createAgentService({getModel:()=>simulation.model,frameDelay:60,request:async(payload,signal)=>{
 await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,300);signal.addEventListener('abort',()=>{clearTimeout(timer);reject(new Error('Отменено'));},{once:true});});
 return payload.tools?{output:[{type:'function_call',call_id:'test-call',name:'simulate_factory',arguments:JSON.stringify(plan)}]}:{output:[{type:'message',content:[{type:'output_text',text:'Остановка окраски ограничивает поток на сборку. Дополнительный штат не устраняет остановку оборудования. Это результат сценарной модели.'}]}]};
}});
const root=path.resolve('public');const types={'.js':'text/javascript','.css':'text/css','.html':'text/html','.png':'image/png','.svg':'image/svg+xml','.json':'application/json','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
const server=http.createServer(async(req,res)=>{try{const url=new URL(req.url,'http://localhost');if(url.pathname==='/healthz'){res.end('ok');return;}if(await agent.handle(req,res,url)||await simulation.handle(req,res,url))return;const file=path.resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));if(!file.startsWith(root+path.sep))throw new Error('Invalid path');const body=await readFile(file);res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');res.end(body);}catch{res.writeHead(404);res.end();}});
server.listen(3286,'127.0.0.1');async function close(){await agent.close();await simulation.close();server.close();}process.on('SIGTERM',close);process.on('SIGINT',close);

import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FactoryModel } from '../../server/allur/engine.js';
import { compilePlan } from '../../server/allur/agent-plan.js';
import { createAgentService } from '../../server/allur/agent-service.js';
const plan={title:'Остановка окраски и усиление сборки',hypothesis:'Проверка производственного потока',horizonHours:1,assumptions:[],parameters:[{key:'lines.assembly.staffAvailable',operation:'add',value:8}],stops:[{area:'paint',afterMinutes:0,durationMinutes:40,kind:'failure'}],deliveries:[]};
const stable={'maintenance.breakdownsEnabled':0};
test('agent plan translates relative staffing, validates bounded commands and never executes arbitrary code',()=>{
 const m=new FactoryModel({factors:stable}),before=m.exportState(),p=compilePlan(plan,before);
 assert.equal(p.scenario.factors['lines.assembly.staffAvailable'],40);assert.equal(p.scenario.commands[0].type,'failure');assert.equal(p.horizonSeconds,3600);assert.deepEqual(m.exportState(),before);
 for(const bad of [ {...plan,horizonHours:100}, {...plan,parameters:[{key:'__proto__.polluted',operation:'set',value:1}]}, {...plan,parameters:[{key:'lines.assembly.staffAvailable',operation:'add',value:-100}]}, {...plan,stops:[{...plan.stops[0],afterMinutes:61}]}, {...plan,deliveries:[{material:'unknown',quantity:10,afterMinutes:0}]}, {...plan,parameters:[{key:'inventory.wheels',operation:'set',value:2}]} ])assert.throws(()=>compilePlan(bad,before));
});
async function fixture(t,request){
 const dir=await mkdtemp(path.join(os.tmpdir(),'allur-agent-test-')),statePath=path.join(dir,'state.json'),model=new FactoryModel({factors:stable});
 const service=await createAgentService({getModel:()=>model,statePath,request,frameDelay:0});
 const server=http.createServer((req,res)=>service.handle(req,res,new URL(req.url,'http://localhost')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base=`http://127.0.0.1:${server.address().port}`;
 const get=async url=>(await fetch(base+url)).json();const post=async(url,data,origin)=>{const r=await fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(data)});return{status:r.status,data:await r.json()};};
 t.after(async()=>{await service.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});});return{service,model,statePath,get,post};
}
test('agent tool performs isolated progressive simulation, explains real results and restores archive',async t=>{
 const calls=[];const f=await fixture(t,async payload=>{calls.push(payload);if(payload.tools)return{output:[{type:'function_call',name:'simulate_factory',arguments:JSON.stringify(plan),call_id:'tool-1'}]};return{output:[{type:'message',content:[{type:'output_text',text:'Окраска ограничила поток на сборку. Дополнительный персонал не устраняет остановку.'}]}]};});
 const before=f.model.exportState(),created=await f.post('/api/agent/chat',{message:'Останови окраску на 40 минут и добавь 8 сборщиков.'});assert.equal(created.status,202);
 let job;for(let i=0;i<150;i++){job=await f.get(created.data.url);if(['completed','failed'].includes(job.status))break;await new Promise(resolve=>setTimeout(resolve,20));}
 assert.equal(job.status,'completed',job.error);assert.equal(job.frameCount,101);assert.equal(job.frames[0].scenario.areas.find(a=>a.id==='paint').status,'down');assert.equal(job.frames.at(-1).progress,1);
 assert.equal(job.result.results.length,2);assert.equal(job.result.seeds.length,3);assert.ok(job.result.results.every(r=>r.runs.every(run=>run.balanced)));assert.deepEqual(f.model.exportState(),before);
 const output=calls[1].input.find(item=>item.type==='function_call_output');assert.equal(output.call_id,'tool-1');assert.equal(JSON.parse(output.output).results[1].summary.produced.median,job.result.results[1].summary.produced.median);
 const tail=await f.get(created.data.url+'?from=100');assert.equal(tail.frames.length,1);
 assert.equal((await f.post('/api/agent/chat',{message:'x'},'https://unrelated.example')).status,403);
 await f.service.close();const restored=await createAgentService({getModel:()=>f.model,statePath:f.statePath,request:async()=>({output:[]})});
 const server=http.createServer((req,res)=>restored.handle(req,res,new URL(req.url,'http://localhost')));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const saved=await(await fetch(`http://127.0.0.1:${server.address().port}`+created.data.url)).json();assert.equal(saved.status,'completed');assert.deepEqual(saved.result,job.result);await restored.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
});
test('plain questions return a response without fabricated simulation, and unsupported tool calls fail',async t=>{
 const f=await fixture(t,async()=>({output:[{type:'message',content:[{type:'output_text',text:'Какой участок нужно остановить и на сколько минут?'}]}]}));const response=await f.post('/api/agent/chat',{message:'Остановить это'});let job;for(let i=0;i<50;i++){job=await f.get(response.data.url);if(job.status==='completed')break;await new Promise(resolve=>setTimeout(resolve,10));}assert.equal(job.frameCount,0);assert.equal(job.result,null);assert.match(job.answer,/Какой участок/);
});

test('concurrent agent requests cannot start two jobs, and cancellation stops provider work',async t=>{
 let aborted=false;const f=await fixture(t,async(payload,signal)=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>{aborted=true;reject(new Error('cancelled'));},{once:true});}));
 const before=f.model.exportState();const requests=await Promise.all([f.post('/api/agent/chat',{message:'first'}),f.post('/api/agent/chat',{message:'second'})]);assert.deepEqual(requests.map(x=>x.status).sort(),[202,429]);
 const created=requests.find(x=>x.status===202);await f.post(created.data.url+'/cancel',{});let job;for(let i=0;i<50;i++){job=await f.get(created.data.url);if(job.status==='cancelled')break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(job.status,'cancelled');assert.equal(aborted,true);assert.deepEqual(f.model.exportState(),before);
});

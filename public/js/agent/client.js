import { useEffect, useRef, useState } from 'preact/hooks';
export async function api(path,body){const response=await fetch('/api/agent'+path,{method:body===undefined?'GET':'POST',headers:body===undefined?undefined:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=await response.json();if(!response.ok)throw new Error(data.error||'Ошибка подключения к DTAI.');return data;}
export const terminal=job=>job&&['completed','failed','cancelled'].includes(job.status);
export const PHASES={planning:'Готовим сценарий',simulating:'Выполняем симуляцию',explaining:'Объясняем результат',completed:'Расчёт завершён',failed:'Нужна корректировка',cancelled:'Запрос остановлен'};
export function useJob(id){
  const [job,setJob]=useState(null),[error,setError]=useState('');
  useEffect(()=>{let alive=true,timer,current=null;setJob(null);setError('');if(!id)return;async function poll(){try{const data=await api(`/jobs/${encodeURIComponent(id)}?from=${current?.frames?.length||0}`);if(!alive)return;current={...data,frames:[...(current?.frames||[]),...data.frames]};setJob(current);setError('');if(!terminal(data))timer=setTimeout(poll,300);}catch(e){if(alive){setError(e.message);timer=setTimeout(poll,2500);}}}poll();return()=>{alive=false;clearTimeout(timer);};},[id]);
  return {job,error};
}
export function usePlayback(job){
  const [index,setIndex]=useState(0),[replaying,setReplaying]=useState(false),[following,setFollowing]=useState(true);
  useEffect(()=>{setIndex(0);setReplaying(false);setFollowing(true);},[job?.id]);
  useEffect(()=>{if(following&&job?.frames?.length)setIndex(job.frames.length-1);},[job?.frames?.length,following]);
  useEffect(()=>{if(!replaying)return;const timer=setInterval(()=>setIndex(old=>{if(old>=job.frames.length-1){setReplaying(false);return old;}return old+1;}),250);return()=>clearInterval(timer);},[replaying,job?.frames?.length]);
  const replay=()=>{setFollowing(false);setIndex(0);setReplaying(true);};
  const seek=value=>{setFollowing(false);setReplaying(false);setIndex(Number(value));};
  return {index,frame:job?.frames?.[index]||null,replaying,following,replay,seek,toggle:()=>{setFollowing(false);setReplaying(!replaying);},follow:()=>{setReplaying(false);setFollowing(true);}};
}

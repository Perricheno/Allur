import { parentPort, workerData } from 'node:worker_threads';
import { FactoryModel } from './engine.js';
import { compareScenarios } from './scenarios.js';
const { state, plan, frameDelay = 150 } = workerData;
function frame(model, before) {
  const s = model.snapshot();
  return { clock:{...s.clock,running:true}, areas:s.areas, configuration:s.configuration, inventory:s.inventory, utilities:s.utilities, spares:s.spares, totals:s.totals, kpis:s.kpis, bottleneck:s.bottleneck, conservation:s.conservation,
    increments:{produced:s.totals.produced-before.totals.produced,shipped:s.totals.shipped-before.totals.shipped,scrapped:s.totals.scrapped-before.totals.scrapped,energyKwh:s.totals.energyKwh-before.totals.energyKwh,modeledCost:s.kpis.modeledCost-before.kpis.modeledCost},
  };
}
try {
  const baseline = new FactoryModel({state}), scenario = new FactoryModel({state}), before=baseline.snapshot();
  scenario.action({type:'configure',factors:plan.scenario.factors},false);
  for(const command of plan.scenario.commands) scenario.action(command,false);
  const step = Math.ceil(plan.horizonSeconds / 100); let elapsed=0;
  const send = () => parentPort.postMessage({ type:'frame', frame:{at:elapsed,progress:elapsed/plan.horizonSeconds,baseline:frame(baseline,before),scenario:frame(scenario,before)} });
  send();
  while(elapsed<plan.horizonSeconds){
    const seconds=Math.min(step,plan.horizonSeconds-elapsed);baseline.advance(seconds);scenario.advance(seconds);elapsed+=seconds;
    send(); if(frameDelay) await new Promise(resolve=>setTimeout(resolve,frameDelay));
  }
  const result=compareScenarios(state,{variants:[plan.scenario],horizonSeconds:plan.horizonSeconds,seeds:[state.seed,(state.seed+1)>>>0,(state.seed+2)>>>0]});
  parentPort.postMessage({type:'result',result});
} catch(error){parentPort.postMessage({type:'error',error:error.message});}

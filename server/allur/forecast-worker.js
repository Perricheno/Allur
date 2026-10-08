import { parentPort, workerData } from 'node:worker_threads';
import { compareScenarios } from './scenarios.js';
try { parentPort.postMessage({ result: compareScenarios(workerData.state, workerData.options) }); }
catch (error) { parentPort.postMessage({ error: error.message }); }

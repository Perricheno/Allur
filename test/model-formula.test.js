import test from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_FACTORS } from '../public/js/model-factors.js';
import { MASTER, MASTER_VARIABLES, buildFormulaSpec } from '../public/js/model-formula.js';
import { MODEL_PARAMS } from '../public/js/network-sim.js';
import { SCHEDULE_DEFAULTS } from '../public/js/schedule-engine.js';
import * as dispatch from '../server/dispatch.js';

const spec = buildFormulaSpec({ params: MODEL_PARAMS, dispatch, schedule: SCHEDULE_DEFAULTS });
const variables = [...MASTER_VARIABLES, ...spec.flatMap(s => s.variables)];
const factorNames = MODEL_FACTORS.filter(f => f.length === 3).map(f => f[1]);

test('every audited factor is tied to at least one variable', () => {
  const covered = new Set(variables.flatMap(v => v.factors));
  const missing = factorNames.filter(n => !covered.has(n));
  assert.deepEqual(missing, []);
});

test('variables reference only existing factors and have unique symbols', () => {
  const known = new Set(factorNames);
  for (const v of variables) for (const f of v.factors) assert.ok(known.has(f), `${v.sym}: неизвестный фактор «${f}»`);
  const syms = variables.map(v => v.sym);
  assert.equal(new Set(syms).size, syms.length, `дубли: ${syms.filter((s, i) => syms.indexOf(s) !== i)}`);
});

test('every symbol used in an equation is defined', () => {
  const defined = new Set(variables.map(v => v.sym));
  const used = [...MASTER, ...spec.flatMap(s => s.equations)].flatMap(e => [...e.text.matchAll(/\{([^}]+)\}/g)].map(m => [e.id, m[1]]));
  const unknown = used.filter(([, sym]) => !defined.has(sym));
  assert.deepEqual(unknown, []);
  const ids = [...MASTER, ...spec.flatMap(s => s.equations)].map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('constants in the formulas come from the code', () => {
  const by = sym => variables.find(v => v.sym === sym);
  assert.equal(by('κ_w').value, dispatch.WRONG_TRACK_FACTOR);
  assert.equal(by('HW').value, dispatch.HEADWAY);
  assert.equal(by('Δ_same').value, MODEL_PARAMS.headwayMin.same);
  assert.equal(by('Λ').value, MODEL_PARAMS.crewLimitMin);
  assert.equal(by('N_th').value, dispatch.NOTIFY_THRESHOLD);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblyAt, ASSEMBLY_TACT, ASSEMBLY_DURATION } from '../public/js/factory/assembly-state.js';

test('installed components remain on the same car at subsequent posts', () => {
  for (let stage = 0; stage < 5; stage++) {
    const state = assemblyAt(stage * ASSEMBLY_TACT + 8);
    assert.equal(state.stage, stage);
    assert.equal(state.count, stage + 1);
    assert.deepEqual(state.installed, Array.from({ length: 5 }, (_, i) => i <= stage));
  }
  assert.equal(assemblyAt(0).count, 0);
  assert.equal(assemblyAt(ASSEMBLY_DURATION).count, 0);
});

test('cars move continuously between posts and keep their spacing', () => {
  for (let stage = 1; stage < 5; stage++) {
    const boundary = stage * ASSEMBLY_TACT;
    assert.ok(Math.abs(assemblyAt(boundary - .001).x - assemblyAt(boundary).x) < .001);
  }
  for (let seconds = 0; seconds < ASSEMBLY_DURATION; seconds += .1) {
    const positions = Array.from({ length: 5 }, (_, slot) => assemblyAt(seconds, slot).x).sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) assert.ok(positions[i] - positions[i - 1] > 5.5, `cars overlap at ${seconds}`);
  }
});

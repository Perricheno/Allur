import test from 'node:test';
import assert from 'node:assert/strict';
import { signalModel } from '../public/js/signal-model.js';
import { BLOCKS, HALF, SEG_LEN, blockSignalX, stationSignalSlots, stationX } from '../public/js/track-geometry.js';

const train = (odd, segment, f) => ({ loc: { kind: 'move', f }, odd, wrong: false, segment });
const model = (live, closures = []) => signalModel({ n: 4, closures, tMin: 0, live });

test('block signals never overlap station signals', () => {
  for (let sgm = 0; sgm < 3; sgm++) {
    const xs = stationX(sgm) + HALF, xe = stationX(sgm + 1) - HALF;
    const edge = [stationSignalSlots(sgm).eExit, stationSignalSlots(sgm + 1).eEntry, stationSignalSlots(sgm).oEntry, stationSignalSlots(sgm + 1).oExit];
    for (const line of ['e', 'o']) for (let b = 1; b < BLOCKS; b++) {
      const x = blockSignalX(line, sgm, b);
      assert.ok(x > xs + 30 && x < xe - 30, 'inside the section');
      for (const e of edge) assert.ok(Math.abs(x - e) > 40, `${line}${b} clear of station signal`);
    }
  }
  assert.equal(SEG_LEN, stationX(1) - stationX(0) - 2 * HALF);
});

test('aspects follow occupancy: red in the block, yellow before it, green elsewhere', () => {
  const free = model([]);
  assert.ok(free.blocks.every(b => b.aspect === 'green'));
  const live = [train(false, 1, 0.5)];            // чётный поезд во 2-м блоке 2-го перегона
  const m = model(live);
  const at = (line, sgm, b) => m.blocks.find(x => x.key === `${line}${sgm}${b}`).aspect;
  assert.equal(at('e', 1, 1), 'red');
  assert.equal(at('e', 1, 2), 'green');
  assert.equal(m.station(1).eExit, 'yellow');     // выходной станции перед занятым блоком 1
  assert.equal(at('o', 1, 1), 'green');           // встречный путь свободен
});

test('closure turns signals red on the closed track only', () => {
  const m = model([], [{ segment: 0, track: 'even', from: 0 }]);
  assert.equal(m.blocks.find(x => x.key === 'e01').aspect, 'red');
  assert.equal(m.blocks.find(x => x.key === 'o01').aspect, 'green');
});

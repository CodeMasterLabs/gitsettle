import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatNear, isExpired, parseNear } from './format.ts';

test('currency round-trips without losing a single yoctoNEAR', () => {
  assert.equal(parseNear('0.000000000000000000000001'), '1');
  assert.equal(parseNear('1000000.000000000000000000000001'), '1000000000000000000000000000001');
  assert.equal(formatNear('50000000000000000000000'), '0.05');
  assert.equal(formatNear('1'), '0.000000000000000000000001');
});
test('reject unsafe, negative, exponent and excess-precision amounts', () => {
  for (const amount of ['-1', '1e3', '01', 'Infinity', '0.0000000000000000000000001', '']) assert.throws(() => parseNear(amount));
});
test('a timely submission remains protected after its deadline', () => {
  assert.equal(isExpired({ status: 'Submitted', deadline: 100 }, 200), false);
  assert.equal(isExpired({ status: 'Open', deadline: 100 }, 100), true);
});

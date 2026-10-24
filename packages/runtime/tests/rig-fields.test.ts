import { expect, test } from 'vitest';
import { validateRig } from '../src/rig/validate';
import { sampleFiles } from './avatar-fixture';

function sampleRig() {
  return JSON.parse(new TextDecoder().decode(sampleFiles()['rig.json']));
}

test('accepts the optional mouth smile curve and expression blend fields', () => {
  const rig = sampleRig();
  rig.mouth.smileCurve = 1.3;
  rig.expression = { blend: 16 };
  expect(validateRig(rig)).toEqual([]);
});

test('rejects invalid optional tuning values and reports their paths', () => {
  const rig = sampleRig();
  rig.mouth.smileCurve = 0;
  rig.expression = { blend: -2 };
  const errors = validateRig(rig).join('\n');
  expect(errors).toContain('rig.mouth.smileCurve: must be positive');
  expect(errors).toContain('rig.expression.blend: must be positive');
});

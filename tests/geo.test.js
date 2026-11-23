import { test, proche, egal } from './harness.js';
import { distanceM, bearingDeg, angleDiff, normalize360, pointToSegment, destination } from '../src/lib/geo.js';

const PARIS = { lat: 48.8566, lon: 2.3522 };
const LYON = { lat: 45.764, lon: 4.8357 };

test('distance Paris → Lyon ≈ 392 km', () => proche(distanceM(PARIS, LYON) / 1000, 392, 2));
test('distance nulle pour un même point', () => egal(distanceM(PARIS, PARIS), 0));
test('cap plein nord = 0°', () => proche(bearingDeg({ lat: 48, lon: 2 }, { lat: 49, lon: 2 }), 0, 0.01));
test('cap plein est ≈ 90°', () => proche(bearingDeg({ lat: 0, lon: 2 }, { lat: 0, lon: 3 }), 90, 0.01));
test('cap initial Paris → Lyon ≈ 150,5° (sud-sud-est)', () => proche(bearingDeg(PARIS, LYON), 150.5, 0.5));
test('destination : 1 km au sud-est, puis distance et cap retrouvés', () => {
  const b = destination(PARIS, 135, 1000);
  proche(distanceM(PARIS, b), 1000, 0.5);
  proche(bearingDeg(PARIS, b), 135, 0.1);
});
test('normalize360 de -90 = 270', () => egal(normalize360(-90), 270));
test('angleDiff 350° → 10° = +20°', () => egal(angleDiff(350, 10), 20));
test('angleDiff 10° → 350° = -20°', () => egal(angleDiff(10, 350), -20));
test('point à ~111 m d\'un segment nord-sud', () => {
  const r = pointToSegment({ lat: 48.5, lon: 2.0015 }, { lat: 48, lon: 2 }, { lat: 49, lon: 2 });
  proche(r.distance, 110.7, 1);
  proche(r.bearing, 0, 0.01);
});
test('point au-delà de l\'extrémité : distance à l\'extrémité', () => {
  const a = { lat: 48, lon: 2 }, b = { lat: 48.001, lon: 2 }, p = { lat: 48.002, lon: 2 };
  proche(pointToSegment(p, a, b).distance, distanceM(p, b), 0.5);
});

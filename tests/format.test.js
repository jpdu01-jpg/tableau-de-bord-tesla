import { test, egal } from './harness.js';
import { texteConsoInstantanee as t } from '../src/lib/format.js';

test('conso : une décimale sous 10', () => egal(t(9.64), ' 9,6'));
test('conso : négative sous 10', () => egal(t(-5.71), '-5,7'));
test('conso : entier à partir de 10', () => egal(t(12.3), '  12'));
test('conso : négative à partir de 10', () => egal(t(-12.3), ' -12'));
test('conso : 9,96 arrondi à 10 → entier', () => egal(t(9.96), '  10'));
test('conso : -9,96 arrondi à -10 → entier', () => egal(t(-9.96), ' -10'));
test('conso : bornée à -99 et 999', () => {
  egal(t(-250), ' -99');
  egal(t(1500), ' 999');
});
test('conso : -0,02 → 0,0 (pas de « -0,0 »)', () => egal(t(-0.02), ' 0,0'));
test('conso : inconnue → --', () => egal(t(null), '  --'));
test('conso : toujours 4 caractères', () => {
  for (let v = -150; v <= 1100; v += 0.37) if (t(v).length !== 4) throw new Error(`${v} → « ${t(v)} »`);
});

import { textePuissance as p } from '../src/lib/format.js';
test('puissance : entier sur 4 caractères', () => {
  egal(p(3.4), '   3');
  egal(p(-12.4), ' -12');
  egal(p(105), ' 105');
});
test('puissance : bornée à -99 et 999', () => {
  egal(p(-150), ' -99');
  egal(p(1200), ' 999');
});
test('puissance : -0,3 → 0 (pas de « -0 »)', () => egal(p(-0.3), '   0'));
test('puissance : inconnue → --', () => egal(p(undefined), '  --'));
test('puissance : toujours 4 caractères', () => {
  for (let v = -150; v <= 1100; v += 0.37) if (p(v).length !== 4) throw new Error(`${v} → « ${p(v)} »`);
});

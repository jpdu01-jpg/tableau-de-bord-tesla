import { test, egal, proche } from './harness.js';
import { relativeWind } from '../src/lib/wind.js';

test('vent du nord, voiture vers le nord → vent de face', () => {
  const v = relativeWind(0, 20, 0);
  egal(v.libelle, 'Vent de face');
  proche(v.face, 20, 0.01);
  proche(v.rotationFleche, 180, 0.01); // la flèche pointe vers l'arrière de la voiture
});
test('vent du nord, voiture vers le sud → vent arrière', () => {
  const v = relativeWind(0, 20, 180);
  egal(v.libelle, 'Vent arrière');
  proche(v.face, -20, 0.01);
});
test('vent d\'ouest, voiture vers le nord → latéral gauche', () => {
  const v = relativeWind(270, 20, 0);
  egal(v.libelle, 'Latéral gauche');
  proche(v.lateral, -20, 0.01);
  proche(v.rotationFleche, 90, 0.01); // souffle vers la droite
});
test('vent d\'est, voiture vers le nord → latéral droite', () => egal(relativeWind(90, 20, 0).libelle, 'Latéral droite'));
test('vent de 45° à droite → de face, droite', () => egal(relativeWind(45, 20, 0).libelle, 'De face, droite'));
test('passage par 0° : vent de 350°, cap 10° → de face', () => egal(relativeWind(350, 20, 10).libelle, 'Vent de face'));
test('vent faible', () => egal(relativeWind(0, 3, 0).libelle, 'Vent faible'));

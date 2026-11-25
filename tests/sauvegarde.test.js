import { test, egal, vrai } from './harness.js';
import { aEnvoyer, marquerEnvoyes, paquets, fusionnerHistoriques } from '../src/lib/sauvegarde.js';
import { TAILLE_MAX } from '../src/lib/historique.js';

const t = (debut, fin, extra = {}) => ({ debut, fin, distanceKm: 10, ...extra });

test('sauvegarde : tout est à envoyer la première fois', () => {
  egal(aEnvoyer([t(1, 10), t(2, 20)]).length, 2);
});
test('sauvegarde : seuls les trajets nouveaux ou prolongés sont renvoyés', () => {
  const envoyes = marquerEnvoyes({}, [t(1, 10), t(2, 20)]);
  const liste = [t(3, 30), t(2, 25), t(1, 10)]; // 3 nouveau, 2 prolongé (trajet repris), 1 inchangé
  egal(aEnvoyer(liste, envoyes).map((r) => r.debut).join(','), '3,2');
  egal(aEnvoyer(liste, marquerEnvoyes(envoyes, liste)).length, 0);
});
test('sauvegarde : marquerEnvoyes ne modifie pas l\'original', () => {
  const envoyes = { 1: 10 };
  marquerEnvoyes(envoyes, [t(2, 20)]);
  egal(Object.keys(envoyes).length, 1);
});
test('sauvegarde : découpage en paquets', () => {
  const liste = Array.from({ length: 450 }, (_, i) => t(i, i));
  egal(paquets(liste).map((p) => p.length).join(','), '200,200,50');
  egal(paquets([]).length, 0);
});
test('sauvegarde : fusion (version la plus avancée gardée, téléphone prioritaire à égalité)', () => {
  const local = [t(3, 30, { destination: 'local' }), t(1, 10, { destination: 'local' })];
  const distant = [t(3, 35, { destination: 'distant' }), t(2, 20), t(1, 10, { destination: 'distant' })];
  const f = fusionnerHistoriques(local, distant);
  egal(f.map((r) => r.debut).join(','), '3,2,1');
  egal(f[0].destination, 'distant'); // plus avancé
  egal(f[2].destination, 'local'); // égalité
});
test('sauvegarde : fusion ignore les données illisibles et limite la taille', () => {
  egal(fusionnerHistoriques([null, { debut: 'x', fin: 1 }], [t(1, 1)]).length, 1);
  const beaucoup = Array.from({ length: TAILLE_MAX + 10 }, (_, i) => t(i, i));
  const f = fusionnerHistoriques(beaucoup, []);
  egal(f.length, TAILLE_MAX);
  vrai(f[0].debut === TAILLE_MAX + 9);
});

import { test, egal, proche, vrai } from './harness.js';
import { resumeTrajet, majHistorique, detailsTrajet, historiqueCsv, totauxHistorique, ENTETES_CSV, DISTANCE_MIN_KM, TAILLE_MAX } from '../src/lib/historique.js';

const DEPART = new Date(2026, 10, 24, 8, 5).getTime(); // 24/11/2026 08:05, heure locale
const MIN = 60000;

test('historique : premier résumé (batterie, destination, météo)', () => {
  const r = resumeTrajet(null, { debut: DEPART, maintenant: DEPART + 10 * MIN, distanceKm: 12, energieKwh: 2.1,
    batteriePct: 66, destination: 'Arpajon', temperature: 8, ventKmh: 20, ventFaceKmh: 15 });
  egal(r.batterieDebutPct, 66);
  egal(r.batterieFinPct, 66);
  egal(r.destination, 'Arpajon');
  const d = detailsTrajet(r);
  egal(d.dureeMin, 10);
  proche(d.kwh100, 17.5, 0.001);
  proche(d.vitesseMoyKmh, 72, 0.001);
  egal(d.temperatureMoy, 8);
  egal(d.ventFaceMoyKmh, 15);
});

test('historique : mise à jour (batterie de départ gardée, météo pondérée par les km)', () => {
  let r = resumeTrajet(null, { debut: DEPART, maintenant: DEPART + MIN, distanceKm: 10, energieKwh: 2, batteriePct: 66,
    temperature: 10, ventKmh: 20, ventFaceKmh: 20 });
  r = resumeTrajet(r, { debut: DEPART, maintenant: DEPART + 2 * MIN, distanceKm: 40, energieKwh: 7, batteriePct: 60,
    temperature: 2, ventKmh: 10, ventFaceKmh: -10 }); // 30 km de plus, plus froid, vent arrière
  egal(r.batterieDebutPct, 66);
  egal(r.batterieFinPct, 60);
  egal(r.tempMin, 2);
  egal(r.tempMax, 10);
  const d = detailsTrajet(r);
  egal(d.batterieUtiliseePct, 6);
  proche(d.temperatureMoy, 4, 1e-9); // (10×10 + 2×30) / 40
  proche(d.ventMoyKmh, 12.5, 1e-9); // (20×10 + 10×30) / 40
  proche(d.ventFaceMoyKmh, -2.5, 1e-9); // (20×10 − 10×30) / 40
});

test('historique : valeurs manquantes (pas de batterie ni de météo) → gardées ou vides', () => {
  let r = resumeTrajet(null, { debut: DEPART, maintenant: DEPART + MIN, distanceKm: 5, energieKwh: 1, batteriePct: 70, destination: 'Paris' });
  r = resumeTrajet(r, { debut: DEPART, maintenant: DEPART + 2 * MIN, distanceKm: 6, energieKwh: 1.2 });
  egal(r.batterieFinPct, 70);
  egal(r.destination, 'Paris');
  const d = detailsTrajet(r);
  egal(d.temperatureMoy, null);
  egal(d.ventFaceMoyKmh, null);
  egal(detailsTrajet({ ...r, distanceKm: 0.8 }).kwh100, null); // moins de 1 km : pas de moyenne
});

test('historique : trajet trop court ignoré, même départ remplacé, plus récent en tête', () => {
  const a = { debut: 1000, fin: 2000, distanceKm: 5 };
  const b = { debut: 5000, fin: 6000, distanceKm: 3 };
  let h = majHistorique([], a);
  h = majHistorique(h, b);
  egal(h.length, 2);
  egal(h[0].debut, 5000);
  h = majHistorique(h, { ...a, distanceKm: 8 });
  egal(h.length, 2);
  egal(h[1].distanceKm, 8);
  egal(majHistorique(h, { debut: 9000, distanceKm: DISTANCE_MIN_KM - 0.1 }), h);
  egal(majHistorique(h, { debut: null, distanceKm: 10 }), h);
});

test('historique : taille limitée', () => {
  let h = [];
  for (let i = 0; i < TAILLE_MAX + 5; i++) h = majHistorique(h, { debut: i, fin: i, distanceKm: 1 });
  egal(h.length, TAILLE_MAX);
  egal(h[0].debut, TAILLE_MAX + 4);
});

test('historique : export CSV (français, « ; », du plus ancien au plus récent)', () => {
  const r1 = resumeTrajet(null, { debut: DEPART, maintenant: DEPART + 45 * MIN, distanceKm: 52.34, energieKwh: 8.765,
    batteriePct: 66, destination: 'Gare; quai "B"', temperature: 3.25, ventKmh: 18, ventFaceKmh: -0.2 });
  const r2 = { debut: DEPART - 86400000, fin: DEPART - 86400000 + 5 * MIN, distanceKm: 0.9, energieKwh: 0.1 };
  const lignes = historiqueCsv([r1, r2]).split('\r\n');
  egal(lignes[0], ENTETES_CSV.join(';'));
  egal(lignes.length, 4); // entête, 2 trajets, ligne vide finale
  vrai(lignes[1].startsWith('23/11/2026;08:05;08:10;5;0,9;0,10;;'), lignes[1]);
  egal(lignes[2], '24/11/2026;08:05;08:50;45;52,3;8,77;16,7;70;66;66;0;3,3;3,3;3,3;18;0;"Gare; quai ""B"""');
  egal(lignes[3], '');
});

test('historique : totaux (consommation moyenne pondérée par les km)', () => {
  const t = totauxHistorique([
    { debut: 0, fin: 30 * MIN, distanceKm: 40, energieKwh: 6 }, // 15 kWh/100
    { debut: 0, fin: 15 * MIN, distanceKm: 10, energieKwh: 3 }, // 30 kWh/100
  ]);
  egal(t.trajets, 2);
  egal(t.distanceKm, 50);
  egal(t.energieKwh, 9);
  egal(t.dureeMin, 45);
  proche(t.kwh100, 18, 1e-9); // 9 kWh / 50 km, pas la moyenne des deux (22,5)
  egal(totauxHistorique([]).kwh100, null);
});

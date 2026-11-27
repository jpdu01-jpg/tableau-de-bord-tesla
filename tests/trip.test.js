import { test, egal, proche } from './harness.js';
import { Trip, powerKw, instantKwhPer100, nouveauTrajetAuDepart, PAUSE_PARKING_MS, PAUSE_SANS_INFO_MS, PAUSE_MAX_MS } from '../src/lib/trip.js';

test('puissance : 400 V × 50 A = 20 kW', () => egal(powerKw(400, 50), 20));
test('puissance : donnée manquante → null', () => egal(powerKw(400, null), null));
test('20 kW à 100 km/h = 20 kWh/100 km', () => egal(instantKwhPer100(20, 100), 20));
test('consommation instantanée à l\'arrêt → null', () => egal(instantKwhPer100(2, 0), null));

test('distance : deux points à ~111 m', () => {
  const t = new Trip();
  t.addPosition({ lat: 48, lon: 2, accuracy: 5, speed: 20, t: 0 });
  t.addPosition({ lat: 48.001, lon: 2, accuracy: 5, speed: 20, t: 5000 });
  proche(t.distanceM, 111.2, 0.5);
});
test('distance : position imprécise ignorée', () => {
  const t = new Trip();
  t.addPosition({ lat: 48, lon: 2, accuracy: 5, speed: 20, t: 0 });
  t.addPosition({ lat: 48.01, lon: 2, accuracy: 200, speed: 20, t: 1000 });
  egal(t.distanceM, 0);
});
test('distance : dérive GPS à l\'arrêt ignorée', () => {
  const t = new Trip();
  t.addPosition({ lat: 48, lon: 2, accuracy: 5, speed: 0, t: 0 });
  t.addPosition({ lat: 48.00005, lon: 2, accuracy: 5, speed: 0, t: 1000 }); // 5,5 m
  egal(t.distanceM, 0);
});
test('énergie : 20 kW pendant 1 h = 20 kWh', () => {
  const t = new Trip();
  for (let s = 0; s <= 3600; s += 2) t.addPower(20, s * 1000);
  proche(t.energieKwh, 20, 0.001);
});
test('énergie : coupure de données > 3 min non intégrée', () => {
  const t = new Trip();
  t.addPower(20, 0);
  t.addPower(20, 300000); // 5 min sans donnée : flux coupé
  egal(t.energieKwh, 0);
});
test('énergie : la récupération (puissance négative) réduit la consommation', () => {
  const t = new Trip();
  t.addPower(-36, 0);
  t.addPower(-36, 10000); // -36 kW pendant 10 s = -0,1 kWh
  proche(t.energieKwh, -0.1, 0.0001);
});
test('moyenne : 18 kWh sur 100 km = 18 kWh/100 km', () => {
  const t = new Trip({ distanceM: 100000, energieKwh: 18 });
  egal(t.moyenneKwhPer100, 18);
});
test('moyenne : moins de 1 km → null', () => egal(new Trip({ distanceM: 500, energieKwh: 1 }).moyenneKwhPer100, null));
test('sauvegarde puis reprise du trajet', () => {
  const t = new Trip();
  t.addPosition({ lat: 48, lon: 2, accuracy: 5, speed: 20, t: 0 });
  t.addPosition({ lat: 48.001, lon: 2, accuracy: 5, speed: 20, t: 5000 });
  t.addPower(20, 0);
  t.addPower(20, 10000);
  const repris = new Trip(JSON.parse(JSON.stringify(t)));
  egal(repris.distanceM, t.distanceM);
  egal(repris.energieKwh, t.energieKwh);
  egal(repris.debut, 0);
});

test('énergie : puissance tenue entre deux messages espacés (envoi seulement si elle change)', () => {
  const t = new Trip();
  t.addPower(30, 0);
  t.addPower(10, 120000); // 30 kW pendant 2 min = 1 kWh, même sans message intermédiaire
  proche(t.energieKwh, 1, 0.0001);
  t.addPower(10, 156000); // puis 10 kW pendant 36 s = 0,1 kWh
  proche(t.energieKwh, 1.1, 0.0001);
});

test('trajet : dernier mouvement = dernière position en mouvement (pas l\'attente à l\'arrêt)', () => {
  const t = new Trip();
  t.addPosition({ lat: 48, lon: 2, accuracy: 5, speed: 20, t: 0 });
  t.addPosition({ lat: 48.001, lon: 2, accuracy: 5, speed: 20, t: 5000 });
  t.addPosition({ lat: 48.00101, lon: 2, accuracy: 5, speed: 0, t: 600000 }); // garé, dérive GPS
  egal(t.dernierMouvement, 5000);
  egal(new Trip(JSON.parse(JSON.stringify(t))).dernierMouvement, 5000); // conservé après rechargement
});
test('trajet : nouveau trajet au redémarrage selon la durée de l\'arrêt', () => {
  egal(nouveauTrajetAuDepart(null, 1e9, true), false); // pas encore roulé
  egal(nouveauTrajetAuDepart(0, PAUSE_PARKING_MS - 1, true), false); // P très bref (manœuvre)
  egal(nouveauTrajetAuDepart(0, PAUSE_PARKING_MS, true), true); // garé (P ou voiture endormie)
  egal(nouveauTrajetAuDepart(0, PAUSE_MAX_MS - 1, false), false); // resté en D (bouchon) : pas coupé
  // Cas réel du 27/11 : arrivée 18:59, boîtier reconnecté voiture déjà en D au départ de 20:30 → nouveau trajet
  egal(nouveauTrajetAuDepart(0, 91 * 60000, false), true);
  egal(nouveauTrajetAuDepart(0, PAUSE_SANS_INFO_MS - 1, null), false); // sans boîtier : feu rouge, bouchon court
  egal(nouveauTrajetAuDepart(0, PAUSE_SANS_INFO_MS, null), true);
});

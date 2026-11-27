import { test, egal, vrai } from './harness.js';
import { valeurTeslemetry, interpreterTeslemetry, resumerConfigTeslemetry, CHAMPS_TESLEMETRY, AGE_MAX_CACHE_MS } from '../src/lib/teslemetry.js';
import { donneesTesla } from '../src/lib/teslaStream.js';
import { navigationDepuisChamps, encoderPolyline } from '../src/lib/navigation.js';

const VIN = 'VIN_DE_TEST_00000';
const T = Date.parse('2026-11-24T12:00:00Z');
const message = (data, extra = {}) => JSON.stringify({ vin: VIN, createdAt: '2026-11-24T12:00:00Z', data, ...extra });

test('Teslemetry : position → { lat, lon }', () => {
  const p = valeurTeslemetry('DestinationLocation', { latitude: 48.589172, longitude: 2.246237 });
  egal(p.lat, 48.589172);
  egal(p.lon, 2.246237);
});
test('Teslemetry : rapport « ShiftStateD » → D, invalide → null', () => {
  egal(valeurTeslemetry('Gear', 'ShiftStateD'), 'D');
  egal(valeurTeslemetry('DestinationName', null), null);
  egal(valeurTeslemetry('DestinationName', 'Arpajon'), 'Arpajon');
});
test('Teslemetry : rapport de boîte transmis à l\'app (fin de trajet sans boîtier)', () => {
  const r = interpreterTeslemetry(message({ Gear: 'ShiftStateP' }), VIN, T);
  egal(donneesTesla(r.champs, {}).rapport, 'P');
  egal(donneesTesla({ Gear: 'Invalid' }, {}).rapport, undefined);
  egal(donneesTesla({ Gear: null }, {}).rapport, undefined);
});
test('Teslemetry : message de données décodé', () => {
  const r = interpreterTeslemetry(message({ PackVoltage: 380, PackCurrent: 50, DestinationName: 'Arpajon', MinutesToArrival: 16.3 }), VIN, T);
  egal(r.type, 'donnees');
  egal(r.signaux, 4);
  egal(r.t, T);
  egal(r.champs.DestinationName, 'Arpajon');
  vrai(!r.cache);
});
test('Teslemetry : conversion vers le tableau de bord (puissance, navigation)', () => {
  const trace = encoderPolyline([{ lat: 48.6, lon: 2.32 }, { lat: 48.59, lon: 2.25 }]);
  const r = interpreterTeslemetry(message({
    PackVoltage: 380, PackCurrent: -25, DestinationName: 'Arpajon', MilesToArrival: 5.7727,
    DestinationLocation: { latitude: 48.589172, longitude: 2.246237 }, RouteLine: btoa(trace),
  }), VIN, T);
  egal(donneesTesla(r.champs, {}).powerKw, -9.5); // récupération
  const nav = navigationDepuisChamps(r.champs);
  egal(nav.destinationNom, 'Arpajon');
  egal(nav.destinationPos.lat, 48.589172);
  egal(nav.trace.length, 2);
  egal(Math.round(nav.kmArrivee * 10) / 10, 9.3);
});
test('Teslemetry : fin de navigation (valeurs invalides) → plus de destination', () => {
  const r = interpreterTeslemetry(message({ DestinationName: null, RouteLine: null }), VIN, T);
  const nav = navigationDepuisChamps(r.champs);
  egal(nav.destinationNom, null);
  egal(nav.trace, null);
});
test('Teslemetry : cache récent gardé, cache ancien ignoré', () => {
  egal(interpreterTeslemetry(message({ BatteryLevel: 67 }, { isCache: true }), VIN, T + 60000).cache, true);
  egal(interpreterTeslemetry(message({ DestinationName: 'Hier' }, { isCache: true }), VIN, T + AGE_MAX_CACHE_MS + 1).type, 'perime');
});
test('Teslemetry : état de la voiture, autre voiture, texte illisible', () => {
  const e = interpreterTeslemetry(JSON.stringify({ vin: VIN, createdAt: '2026-11-24T12:00:00Z', state: 'asleep' }), VIN, T);
  egal(e.type, 'etat');
  egal(e.etat, 'asleep');
  egal(interpreterTeslemetry(message({ BatteryLevel: 1 }, { vin: 'AUTRE' }), VIN, T).type, 'autre');
  egal(interpreterTeslemetry('???', VIN, T).type, 'autre');
});
test('Teslemetry : résumé de la configuration', () => {
  const r = resumerConfigTeslemetry({ fields: { DestinationName: {}, BatteryLevel: {} }, streaming_allowance_percent: 12.5 });
  egal(r.nbChamps, 2);
  vrai(r.manquants.includes('RouteLine'));
  vrai(!r.manquants.includes('BatteryLevel'));
  egal(r.allocationPct, 12.5);
  egal(resumerConfigTeslemetry({ fields: Object.fromEntries(CHAMPS_TESLEMETRY.map((c) => [c, {}])) }).manquants.length, 0);
  egal(resumerConfigTeslemetry({}), null);
});

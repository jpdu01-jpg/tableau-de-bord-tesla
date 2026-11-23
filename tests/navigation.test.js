import { test, egal, proche, vrai } from './harness.js';
import {
  decoderPolyline, encoderPolyline, decoderRouteLine, navigationDepuisChamps, navigationActive,
  basculeAuto, heureArrivee, zoomPourVitesse,
} from '../src/lib/navigation.js';

// Exemple officiel Google (précision 5)
test('polyligne : exemple Google', () => {
  const p = decoderPolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@', 5);
  egal(p.length, 3);
  proche(p[0].lat, 38.5, 1e-9);
  proche(p[0].lon, -120.2, 1e-9);
  proche(p[2].lat, 43.252, 1e-9);
  proche(p[2].lon, -126.453, 1e-9);
});

const TRACE = [{ lat: 48.4046, lon: 2.70152 }, { lat: 48.0, lon: 3.1 }, { lat: 47.7986, lon: 3.5672 }];
test('polyligne : encodage puis décodage (précision 6)', () => {
  const p = decoderPolyline(encoderPolyline(TRACE, 6), 6);
  egal(p.length, 3);
  proche(p[2].lat, 47.7986, 1e-6);
  proche(p[2].lon, 3.5672, 1e-6);
});

// Construit un RouteLine comme la voiture : protobuf { 1: polyligne, 2: longueurs } en base64
function routeLineProtobuf(points) {
  const poly = encoderPolyline(points, 6);
  const octets = [0x0a, ...varint(poly.length), ...[...poly].map((c) => c.charCodeAt(0)), 0x15, 0, 0, 0x48, 0x42];
  return btoa(String.fromCharCode(...octets));
}
function varint(n) {
  const r = [];
  while (n >= 0x80) { r.push((n & 0x7f) | 0x80); n >>>= 7; }
  r.push(n);
  return r;
}
const LONGUE = Array.from({ length: 80 }, (_, i) => ({ lat: 48 + i * 0.01, lon: 2.5 + i * 0.013 }));

test('RouteLine : base64 + protobuf (format réel)', () => {
  const p = decoderRouteLine(routeLineProtobuf(TRACE));
  egal(p.length, 3);
  proche(p[0].lat, 48.4046, 1e-6);
});
test('RouteLine : long tracé (longueur sur 2 octets)', () => egal(decoderRouteLine(routeLineProtobuf(LONGUE)).length, 80));
test('RouteLine : polyligne en base64', () => egal(decoderRouteLine(btoa(encoderPolyline(TRACE))).length, 3));
test('RouteLine : polyligne en clair', () => egal(decoderRouteLine(encoderPolyline(TRACE)).length, 3));
test('RouteLine : absent ou illisible → null', () => {
  egal(decoderRouteLine(null), null);
  egal(decoderRouteLine(''), null);
  egal(decoderRouteLine('!!!!!!'), null);
});

test('champs : conversion miles → km et noms', () => {
  const d = navigationDepuisChamps({
    DestinationName: 'Lyon', DestinationLocation: { lat: 45.76, lon: 4.83 }, MinutesToArrival: 95,
    MilesToArrival: 100, RouteTrafficMinutesDelay: 4, ExpectedEnergyPercentAtTripArrival: 31,
  });
  egal(d.destinationNom, 'Lyon');
  egal(d.destinationPos.lat, 45.76);
  egal(d.minutesArrivee, 95);
  proche(d.kmArrivee, 160.9, 0.1);
  egal(d.retardTraficMin, 4);
  egal(d.batterieArriveePct, 31);
});
test('champs : seuls les champs reçus sont renvoyés', () => {
  const d = navigationDepuisChamps({ MinutesToArrival: 12 });
  egal(Object.keys(d).join(), 'minutesArrivee');
});
test('champs : navigation annulée → null', () => {
  const d = navigationDepuisChamps({ DestinationName: null, MilesToArrival: null, RouteLine: null });
  egal(d.destinationNom, null);
  egal(d.kmArrivee, null);
  egal(d.trace, null);
});

test('navigation active : destination ou tracé', () => {
  vrai(navigationActive({ destinationNom: 'Lyon' }));
  vrai(navigationActive({ trace: TRACE }));
  vrai(!navigationActive({ destinationNom: null, trace: null }));
  vrai(!navigationActive(null));
});
test('bascule auto : destination saisie → ouvrir', () => egal(basculeAuto(false, true), 'ouvrir'));
test('bascule auto : destination supprimée → fermer', () => egal(basculeAuto(true, false), 'fermer'));
test('bascule auto : pas de changement → choix manuel respecté', () => {
  egal(basculeAuto(true, true), null);
  egal(basculeAuto(false, false), null);
});

test('heure d\'arrivée : maintenant + minutes', () =>
  egal(heureArrivee(Date.UTC(2026, 10, 23, 10, 0), 95).getTime(), Date.UTC(2026, 10, 23, 11, 35)));
test('heure d\'arrivée : inconnue → null', () => {
  egal(heureArrivee(0, null), null);
  egal(heureArrivee(0, -1), null);
});
test('zoom : plus large sur autoroute', () => {
  egal(zoomPourVitesse(0), 16.5);
  egal(zoomPourVitesse(150), 14);
  egal(zoomPourVitesse(300), 14);
  vrai(zoomPourVitesse(90) < zoomPourVitesse(50));
});

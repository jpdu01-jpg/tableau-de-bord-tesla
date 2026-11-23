import { test, egal, proche, vrai } from './harness.js';
import {
  messageAbonnement, decoderValeurs, interpreterMessage, COLONNES,
  messageAbonnementBrut, valeurSignal, interpreterMessageBrut, texteValeur,
} from '../src/lib/teslaStream.js';

const VIN = '7SAYGDEF0RF000000';
// heure, vitesse (mph), odomètre (mi), batterie, altitude, cap estimé, lat, lon, puissance, rapport, autonomie, autonomie estimée, cap
const LIGNE = '1795457000000,75,12345.6,64,120,182,47.94,3.24,28,D,190,170,181';

test('abonnement : format attendu par le serveur', () => {
  const m = JSON.parse(messageAbonnement('jeton', VIN));
  egal(m.msg_type, 'data:subscribe_oauth');
  egal(m.tag, VIN);
  egal(m.value, COLONNES.join(','));
});
test('décodage : vitesse 75 mph ≈ 120,7 km/h', () => proche(decoderValeurs(LIGNE).vitesseKmh, 120.7, 0.1));
test('décodage : batterie, puissance, rapport', () => {
  const d = decoderValeurs(LIGNE);
  egal(d.batteriePct, 64);
  egal(d.puissanceKw, 28);
  egal(d.rapport, 'D');
});
test('décodage : odomètre en km', () => proche(decoderValeurs(LIGNE).odometreKm, 19868.3, 0.1)); // 12 345,6 mi × 1,609344
test('décodage : champ vide → null', () => egal(decoderValeurs('1795457000000,,12345.6,64,120,182,47.94,3.24,-12,,190,170,181').vitesseKmh, null));
test('décodage : récupération = puissance négative', () =>
  egal(decoderValeurs('1795457000000,50,1,64,1,1,1,1,-12,D,1,1,1').puissanceKw, -12));
test('décodage : nombre de colonnes incohérent → null', () => egal(decoderValeurs('1,2,3'), null));
test('message : données pour notre voiture', () => {
  const r = interpreterMessage(JSON.stringify({ msg_type: 'data:update', tag: VIN, value: LIGNE }), VIN);
  egal(r.type, 'donnees');
  egal(r.donnees.batteriePct, 64);
});
test('message : données d\'une autre voiture ignorées', () =>
  egal(interpreterMessage(JSON.stringify({ msg_type: 'data:update', tag: 'AUTRE', value: LIGNE }), VIN).type, 'autre'));
test('message : erreur (voiture déconnectée)', () => {
  const r = interpreterMessage(JSON.stringify({ msg_type: 'data:error', tag: VIN, error_type: 'vehicle_disconnected' }), VIN);
  egal(r.type, 'erreur');
  egal(r.erreur, 'vehicle_disconnected');
});
test('message : texte non JSON → autre', () => vrai(interpreterMessage('???', VIN).type === 'autre'));

// ---------- Format brut (Fleet Telemetry) ----------
const BRUT = JSON.stringify({
  vin: VIN,
  createdAt: '2026-11-23T18:00:00Z',
  data: [
    { key: 'CruiseSetSpeed', value: { doubleValue: 130 } },
    { key: 'PackVoltage', value: { stringValue: '398.5' } },
    { key: 'Location', value: { locationValue: { latitude: 47.94, longitude: 3.24 } } },
    { key: 'Gear', value: { shiftStateValue: 'ShiftStateD' } },
    { key: 'DestinationName', value: { stringValue: 'Lyon' } },
    { key: 'MinutesToArrival', value: { invalid: true } },
  ],
});

test('brut : abonnement subscribe_all avec jeton et VIN', () => {
  const m = JSON.parse(messageAbonnementBrut('jeton', VIN));
  egal(m.msg_type, 'data:subscribe_all');
  egal(m.token, 'jeton');
  egal(m.tag, VIN);
});
test('brut : valeur numérique', () => egal(valeurSignal({ doubleValue: 130 }), 130));
test('brut : nombre envoyé en texte → nombre', () => egal(valeurSignal({ stringValue: '398.5' }), 398.5));
test('brut : texte conservé', () => egal(valeurSignal({ stringValue: 'Lyon' }), 'Lyon'));
test('brut : position → lat/lon', () => {
  const p = valeurSignal({ locationValue: { latitude: 47.94, longitude: 3.24 } });
  egal(p.lat, 47.94);
  egal(p.lon, 3.24);
});
test('brut : rapport « ShiftStateD » → D', () => egal(valeurSignal({ shiftStateValue: 'ShiftStateD' }), 'D'));
test('brut : invalid (pas de destination) → null', () => egal(valeurSignal({ invalid: true }), null));
test('brut : message de données décodé', () => {
  const r = interpreterMessageBrut(BRUT, VIN);
  egal(r.type, 'donnees');
  egal(r.signaux, 6);
  egal(r.champs.CruiseSetSpeed, 130);
  egal(r.champs.Gear, 'D');
  egal(r.champs.MinutesToArrival, null);
  egal(r.t, Date.parse('2026-11-23T18:00:00Z'));
});
test('brut : données d\'une autre voiture ignorées', () =>
  egal(interpreterMessageBrut(JSON.stringify({ vin: 'AUTRE', data: [] }), VIN).type, 'autre'));
test('brut : erreur du serveur', () => {
  const r = interpreterMessageBrut(JSON.stringify({ msg_type: 'error', error_detail: 'invalid token' }), VIN);
  egal(r.type, 'erreur');
  egal(r.erreur, 'invalid token');
});
test('brut : message de maintien de connexion → autre', () =>
  egal(interpreterMessageBrut(JSON.stringify({ msg_type: 'control:hello:' + VIN }), VIN).msgType, 'control:hello:' + VIN));
test('brut : texte non JSON → autre', () => egal(interpreterMessageBrut('???', VIN).type, 'autre'));
test('affichage : longue chaîne coupée', () => egal(texteValeur('a'.repeat(50), 10), 'aaaaaaaaaa… (50 caractères)'));
test('affichage : position et valeur absente', () => {
  egal(texteValeur({ lat: 47.94, lon: 3.24 }), '47.94, 3.24');
  egal(texteValeur(null), '—');
});

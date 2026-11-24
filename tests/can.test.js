import { test, egal, proche, vrai } from './harness.js';
import { lireBits, decouperTrames, decoderPaquet, donneesTeslogic } from '../src/lib/can.js';

// Trames réelles tirées de la capture Teslogic du 24/11/2026 (10 octets : identifiant + contenu).
const hex = (t) => Uint8Array.from(t.split(' '), (o) => parseInt(o, 16));
const BATTERIE_HT = '32 01 29 94 ab fe 99 3d 00 00'; // 379,29 V, 34,1 A
const VITESSE = '57 12 31 cf 3a 23 2e 60 1d 01'; // 35 km/h
const NIVEAU = '92 02 e6 52 bb ae ba 01 00 00'; // 74,2 %
const REGULATEUR = 'b9 12 65 41 44 7f 90 fa b7 65'; // consigne 35,7 km/h, état 4
const AUTOPILOT = '99 13 01 0a ff 80 b0 44 f1 0b'; // Autopilot 1 (indisponible), limitation 50 km/h
const paquet = (...trames) => hex(trames.join(' '));

test('CAN : lecture de bits petit-boutiste', () => {
  egal(lireBits(hex('29 94'), 0, 16), 0x9429);
  egal(lireBits(hex('ab fe'), 0, 16, true), -341);
  egal(lireBits(hex('65 41'), 12, 4), 4);
});
test('CAN : découpage d\'un paquet en trames de 10 octets', () => {
  const t = decouperTrames(paquet(BATTERIE_HT, VITESSE));
  egal(t.length, 2);
  egal(t[0].id, 0x132);
  egal(t[1].id, 0x1257);
  egal(t[1].octets.length, 8);
});
test('CAN : tension, courant et puissance (capture réelle)', () => {
  const v = decoderPaquet(paquet(BATTERIE_HT));
  proche(v.tensionV, 379.29, 0.001);
  proche(v.courantA, 34.1, 0.001);
  proche(donneesTeslogic(v).powerKw, 12.93, 0.01);
});
test('CAN : récupération = puissance négative', () => {
  // même tension, courant +34,1 A en charge (octets du courant inversés : 0x0155 = 341)
  proche(donneesTeslogic(decoderPaquet(paquet('32 01 29 94 55 01 00 00 00 00'))).powerKw, -12.93, 0.01);
});
test('CAN : vitesse, batterie, régulateur, limitation (capture réelle)', () => {
  const v = decoderPaquet(paquet(VITESSE, NIVEAU, REGULATEUR, AUTOPILOT));
  egal(v.vitesseKmh, 35);
  proche(v.batteriePct, 74.2, 0.001);
  proche(v.consigneKmh, 35.7, 0.001);
  egal(v.etatRegulateur, 4);
  egal(v.etatAutopilot, 1);
  egal(v.limiteKmh, 50);
  const d = donneesTeslogic(v);
  egal(d.speedKmh, 35);
  egal(d.batteryPct, 74);
  egal(d.limitKmh, 50);
  egal(d.cruiseKmh, null); // Autopilot pas enclenché : la consigne suit la vitesse, on ne l'affiche pas
});
test('CAN : consigne affichée quand l\'Autopilot est actif', () => {
  const v = decoderPaquet(paquet(REGULATEUR, '99 13 03 0a ff 80 b0 44 f1 0b'));
  egal(donneesTeslogic(v).cruiseKmh, 36);
});
test('CAN : limitation « aucune » (31) → null, « inconnue » (0) → ignorée', () => {
  egal(decoderPaquet(paquet('99 13 01 1f 00 00 00 00 00 00')).limiteKmh, null);
  vrai(!('limiteKmh' in decoderPaquet(paquet('99 13 01 00 00 00 00 00 00 00'))));
});
test('CAN : messages inconnus ignorés, paquet vide', () => {
  egal(Object.keys(decoderPaquet(paquet('99 03 01 0a 00 00 00 00 00 00'))).length, 0); // 0x399 sur le bus 0 : vide
  egal(Object.keys(donneesTeslogic(decoderPaquet(new Uint8Array(0)))).length, 0);
});

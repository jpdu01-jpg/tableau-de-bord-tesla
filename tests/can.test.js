import { test, egal, proche, vrai } from './harness.js';
import { lireBits, decouperTrames, decoderPaquet, donneesTeslogic } from '../src/lib/can.js';

// Trames réelles tirées de la capture Teslogic du 24/11/2026 (10 octets : identifiant + contenu).
const hex = (t) => Uint8Array.from(t.split(' '), (o) => parseInt(o, 16));
const BATTERIE_HT = '32 01 29 94 ab fe 99 3d 00 00'; // 379,29 V, 34,1 A
const VITESSE = '57 12 31 cf 3a 23 2e 60 1d 01'; // 35 km/h
const NIVEAU = '92 02 e6 52 bb ae ba 01 00 00'; // SOCUI 72,4 %
const ENERGIE_0 = '52 03 00 80 87 0e 8c 0a 6d 0a'; // capacité 74,38 kWh, reste 54,0 kWh
const ENERGIE_1 = '52 03 01 00 50 01 6d 0a a6 00'; // réserve 3,36 kWh
const REGULATEUR_ACTIF = '86 22 3c 2c 5b 23 02 08 00 00'; // régulateur enclenché, consigne 91 km/h
const REGULATEUR_PRET = '86 22 fd 12 32 23 02 0c 00 00'; // régulateur prêt (non enclenché), 50 km/h proposés
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
  const v = decoderPaquet(paquet(VITESSE, NIVEAU, REGULATEUR_PRET, AUTOPILOT));
  egal(v.vitesseKmh, 35);
  proche(v.batteriePct, 72.4, 0.001);
  proche(v.consigneKmh, 50, 0.001);
  egal(v.etatRegulateur, 1);
  egal(v.etatAutopilot, 1);
  egal(v.limiteKmh, 50);
  const d = donneesTeslogic(v);
  egal(d.speedKmh, 35);
  egal(d.batteryPct, 72); // secours tant que l'énergie (0x352) n'est pas reçue
  egal(d.limitKmh, 50);
  egal(d.cruiseKmh, null); // régulateur seulement prêt : la consigne suit la vitesse, on ne l'affiche pas
  egal(d.autopilotActif, false);
});
test('CAN : batterie affichée = énergie hors réserve (71 % noté sur la capture)', () => {
  const memoire = {};
  const e0 = decoderPaquet(paquet(ENERGIE_0));
  proche(e0.energiePleineKwh, 74.38, 0.001);
  proche(e0.energieRestanteKwh, 54.0, 0.001);
  vrai(!('batteryPct' in donneesTeslogic(e0, memoire))); // réserve pas encore connue
  const e1 = decoderPaquet(paquet(ENERGIE_1, NIVEAU));
  proche(e1.reserveKwh, 3.36, 0.001);
  egal(donneesTeslogic(e1, memoire).batteryPct, 71); // (54,0 − 3,36) / (74,38 − 3,36)
  egal(donneesTeslogic(decoderPaquet(paquet(NIVEAU)), memoire).batteryPct, undefined); // 0x292 ne l'écrase plus
});
test('CAN : consigne affichée quand le régulateur est enclenché', () => {
  const v = decoderPaquet(paquet(REGULATEUR_ACTIF));
  egal(v.etatRegulateur, 2);
  egal(donneesTeslogic(v).cruiseKmh, 91);
  vrai(!('autopilotActif' in donneesTeslogic(v))); // régulateur seul : pas de volant bleu
  egal(donneesTeslogic(decoderPaquet(paquet('86 22 3c 2c 5b 22 02 08 00 00'))).cruiseKmh, 146); // bit d'unité à 0 : mph
  vrai(!('cruiseKmh' in donneesTeslogic(decoderPaquet(paquet('86 02 e5 28 5d 28 31 00 00 00'))))); // bus 0 figé : ignoré
});
test('CAN : Autopilot actif pour les états 3, 4, 5 seulement', () => {
  const etat = (n) => donneesTeslogic(decoderPaquet(paquet(`99 13 0${n} 0a 00 00 00 00 00 00`))).autopilotActif;
  egal([0, 1, 2, 3, 4, 5, 8].map(etat).join(), 'false,false,false,true,true,true,false');
  vrai(!('autopilotActif' in donneesTeslogic(decoderPaquet(paquet(VITESSE))))); // pas d'information → pas de valeur
});
test('CAN : limitation « aucune » (31) → null, « inconnue » (0) → ignorée', () => {
  egal(decoderPaquet(paquet('99 13 01 1f 00 00 00 00 00 00')).limiteKmh, null);
  vrai(!('limiteKmh' in decoderPaquet(paquet('99 13 01 00 00 00 00 00 00 00'))));
});
test('CAN : messages inconnus ignorés, paquet vide', () => {
  egal(Object.keys(decoderPaquet(paquet('99 03 01 0a 00 00 00 00 00 00'))).length, 0); // 0x399 sur le bus 0 : vide
  egal(Object.keys(donneesTeslogic(decoderPaquet(new Uint8Array(0)))).length, 0);
});

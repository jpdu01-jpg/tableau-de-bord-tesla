// Décodage des trames CAN reçues du boîtier Teslogic V2 (Bluetooth). Fonctions pures, testées dans tests/can.test.js.
//
// Le boîtier envoie des paquets de 240 octets = 24 trames de 10 octets :
//   2 octets : identifiant du message (petit-boutiste ; le chiffre des milliers en hexadécimal = numéro du bus CAN)
//   8 octets : contenu du message.
// Les positions des valeurs viennent des descriptions publiques des messages Tesla (fichiers « DBC » d'opendbc)
// et ont été vérifiées sur une capture réelle de la voiture (24/11/2026).

/** Lit `n` bits à partir du bit `debut` (ordre petit-boutiste, comme Tesla). */
export function lireBits(octets, debut, n, signe = false) {
  let v = 0;
  for (let i = 0; i < n; i++) {
    const b = debut + i;
    if (octets[b >> 3] & (1 << (b & 7))) v += 2 ** i;
  }
  return signe && v >= 2 ** (n - 1) ? v - 2 ** n : v;
}

/** Découpe un paquet Bluetooth en trames : [{ id, octets }]. */
export function decouperTrames(paquet) {
  const trames = [];
  for (let i = 0; i + 10 <= paquet.length; i += 10) {
    trames.push({ id: paquet[i] | (paquet[i + 1] << 8), octets: paquet.subarray(i + 2, i + 10) });
  }
  return trames;
}

/**
 * Valeurs brutes d'un paquet (seulement celles présentes ; la dernière trame de chaque type l'emporte) :
 * { tensionV, courantA, vitesseKmh, batteriePct, consigneKmh, etatRegulateur, etatAutopilot, limiteKmh }.
 * limiteKmh vaut null quand la voiture ne connaît pas de limitation.
 */
export function decoderPaquet(paquet) {
  const v = {};
  for (const { id, octets } of decouperTrames(paquet)) {
    switch (id) {
      case 0x132: // batterie haute tension : tension et courant (positif = la batterie se décharge)
        v.tensionV = lireBits(octets, 0, 16) * 0.01;
        v.courantA = lireBits(octets, 16, 16, true) * -0.1;
        break;
      case 0x257:
      case 0x1257: // vitesse affichée au tableau de bord
        v.vitesseKmh = lireBits(octets, 24, 9);
        break;
      case 0x292: // niveau de batterie affiché
        v.batteriePct = lireBits(octets, 0, 10) * 0.1;
        break;
      case 0x2b9:
      case 0x12b9: { // aide à la conduite : consigne du régulateur et son état
        const c = lireBits(octets, 0, 12);
        v.consigneKmh = c === 4095 ? null : c * 0.1;
        v.etatRegulateur = lireBits(octets, 12, 4);
        break;
      }
      case 0x1399: { // état de l'Autopilot et limitation de vitesse connue de la voiture (bus 1 seulement)
        v.etatAutopilot = lireBits(octets, 0, 4);
        const l = lireBits(octets, 8, 5); // par pas de 5 km/h ; 31 = aucune, 0 = inconnue
        if (l !== 0) v.limiteKmh = l === 31 ? null : l * 5;
        break;
      }
    }
  }
  return v;
}

// États « Autopilot actif » de DAS_autopilotState (3 = actif, 4 = actif restreint, 5 = navigation Autopilot).
// À CONFIRMER : la capture du 24/11 a été faite sans régulateur. Le régulateur seul (sans maintien de voie)
// n'est peut-être pas signalé ici : une capture sur route avec le régulateur enclenché permettra de compléter.
const AUTOPILOT_ACTIF = [3, 4, 5];

/** Convertit les valeurs brutes en données du tableau de bord (mêmes noms que les autres sources Tesla). */
export function donneesTeslogic(v) {
  const d = {};
  if (v.tensionV != null && v.courantA != null) d.powerKw = (v.tensionV * v.courantA) / 1000;
  if (v.vitesseKmh != null) d.speedKmh = v.vitesseKmh;
  if (v.batteriePct != null) d.batteryPct = Math.round(v.batteriePct);
  if (v.etatAutopilot != null) {
    d.cruiseKmh = AUTOPILOT_ACTIF.includes(v.etatAutopilot) && v.consigneKmh > 0 ? Math.round(v.consigneKmh) : null;
  }
  if ('limiteKmh' in v) d.limitKmh = v.limiteKmh;
  return d;
}

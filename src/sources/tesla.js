// Données Tesla : puissance batterie et vitesse du régulateur.
//
// Champs Fleet Telemetry prévus (facturés par signal, voir docs/tesla-fleet-api-donnees.md) :
//   PackVoltage, PackCurrent  → puissance (kW) = tension × courant / 1000
//   CruiseSetSpeed            → vitesse programmée du régulateur
//   BatteryLevel              → niveau de batterie (%), intervalle 60 s : ~1 signal par minute au maximum,
//                               soit < 500 signaux pour 8 h ≈ 0,01 € par trajet
//
// ⚠️ Pas encore branché : il faut d'abord un compte MyTeslaMate (plan API) et la documentation
// de leur flux temps réel. En attendant, l'application affiche « Tesla non connectée ».

export const TESLA_NON_CONNECTEE = 'non connectée';

/**
 * Interface commune à toutes les sources Tesla :
 *   start(onData)  → onData({ powerKw?, cruiseKmh?, batteryPct?, t }) à chaque nouvelle valeur
 *                    (seuls les champs reçus sont présents)
 *   stop()
 *   etat           → 'non connectée' | 'connexion' | 'ok' | 'erreur' | 'simulation'
 */
export class TeslaNonConnectee {
  etat = TESLA_NON_CONNECTEE;
  start() {}
  stop() {}
}

// Futur : class TeslaMyTeslaMate { ... } qui ouvrira le flux WebSocket de MyTeslaMate
// avec un jeton saisi par l'utilisateur (stocké uniquement dans le navigateur).

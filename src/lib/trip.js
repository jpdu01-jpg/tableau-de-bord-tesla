// Suivi d'un trajet : distance (GPS du téléphone) et énergie (puissance batterie Tesla).
// Classe pure (pas d'accès au navigateur), testée dans tests/trip.test.js.
import { distanceM } from './geo.js';

const PRECISION_MAX_M = 35; // on ignore les positions GPS moins précises que ça
// La voiture n'envoie la puissance que quand elle change : entre deux messages, elle garde la dernière valeur.
// Les messages peuvent donc être espacés de plus d'une minute en roulant à allure stable.
// Au-delà de TROU_MAX_S, on considère que le flux a été coupé et on n'intègre pas.
const TROU_MAX_S = 180;

// Fin automatique d'un trajet (une ligne d'historique par étape, comme les autres applis de trajets) : le trajet
// s'arrête au dernier mouvement ; au redémarrage, on commence un NOUVEAU trajet si l'arrêt a assez duré.
export const PAUSE_PARKING_MS = 5 * 60000; // voiture mise en P (boîtier ou Teslemetry) ou endormie
export const PAUSE_SANS_INFO_MS = 10 * 60000; // rapport de boîte inconnu : seul le GPS dit que l'on ne bouge plus
// Arrêt très long : nouveau trajet même si le dernier rapport connu n'est pas P (le boîtier a pu être déconnecté
// pendant la mise en P, puis reconnecté voiture déjà en D au départ suivant).
export const PAUSE_MAX_MS = 30 * 60000;
export const VITESSE_DEPART_KMH = 5; // au-dessus, on roule de nouveau

/**
 * Au redémarrage : faut-il commencer un nouveau trajet ?
 * @param parque true = mise en P ou voiture endormie depuis le dernier mouvement ; false = rapport connu et jamais P
 *               (bouchon : on ne coupe pas, sauf arrêt de plus de 30 min) ; null = inconnu (pas de boîtier)
 */
export function nouveauTrajetAuDepart(dernierMouvement, maintenant, parque) {
  if (dernierMouvement == null) return false;
  const pause = maintenant - dernierMouvement;
  if (parque === false) return pause >= PAUSE_MAX_MS;
  return pause >= (parque ? PAUSE_PARKING_MS : PAUSE_SANS_INFO_MS);
}

/** Puissance en kW à partir de la tension (V) et du courant (A) de la batterie. */
export function powerKw(tension, courant) {
  if (tension == null || courant == null) return null;
  return (tension * courant) / 1000;
}

/** Consommation instantanée en kWh/100 km. Null à très basse vitesse (valeur sans signification). */
export function instantKwhPer100(puissanceKw, vitesseKmh) {
  if (puissanceKw == null || vitesseKmh == null || vitesseKmh < 5) return null;
  return (puissanceKw / vitesseKmh) * 100;
}

export class Trip {
  constructor(etat = null) {
    this.distanceM = 0;
    this.energieKwh = 0;
    this.debut = null; // horodatage (ms) du premier point
    this.dernierPoint = null; // {lat, lon, t}
    this.dernierMouvement = null; // heure (ms) de la dernière position en mouvement : la « fin » du trajet
    this.dernierePuissance = null; // {kw, t}
    if (etat) Object.assign(this, etat);
  }

  /** Ajoute une position GPS : {lat, lon, accuracy, speed (m/s), t (ms)}. */
  addPosition(p) {
    if (this.debut == null) this.debut = p.t;
    if (p.accuracy != null && p.accuracy > PRECISION_MAX_M) return;
    if (this.dernierPoint) {
      const d = distanceM(this.dernierPoint, p);
      const enMouvement = (p.speed ?? 0) > 1 || d > 15; // filtre la « dérive » GPS à l'arrêt
      if (!enMouvement) return;
      this.distanceM += d;
      this.dernierMouvement = p.t;
    }
    this.dernierPoint = { lat: p.lat, lon: p.lon, t: p.t };
  }

  /** Ajoute une mesure de puissance batterie : kW (positif = consommation), t (ms). */
  addPower(kw, t) {
    if (this.debut == null) this.debut = t;
    const prec = this.dernierePuissance;
    if (prec) {
      const dt = (t - prec.t) / 1000;
      if (dt > 0 && dt <= TROU_MAX_S) {
        this.energieKwh += prec.kw * (dt / 3600); // la valeur précédente est restée valable jusqu'à maintenant
      }
    }
    this.dernierePuissance = { kw, t };
  }

  get distanceKm() {
    return this.distanceM / 1000;
  }

  /** Consommation moyenne en kWh/100 km (null tant que moins de 1 km parcouru). */
  get moyenneKwhPer100() {
    if (this.distanceKm < 1) return null;
    return (this.energieKwh / this.distanceKm) * 100;
  }

  dureeS(maintenant) {
    return this.debut == null ? 0 : Math.max(0, (maintenant - this.debut) / 1000);
  }

  /** État sérialisable, pour reprendre le trajet après un rechargement de la page. */
  toJSON() {
    const { distanceM, energieKwh, debut, dernierPoint, dernierePuissance, dernierMouvement } = this;
    return { distanceM, energieKwh, debut, dernierPoint, dernierePuissance, dernierMouvement };
  }
}

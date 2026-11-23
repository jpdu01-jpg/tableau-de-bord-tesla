// Suivi d'un trajet : distance (GPS du téléphone) et énergie (puissance batterie Tesla).
// Classe pure (pas d'accès au navigateur), testée dans tests/trip.test.js.
import { distanceM } from './geo.js';

const PRECISION_MAX_M = 35; // on ignore les positions GPS moins précises que ça
const TROU_MAX_S = 30; // au-delà, on n'intègre pas la puissance (coupure de données)

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
        this.energieKwh += ((prec.kw + kw) / 2) * (dt / 3600); // méthode des trapèzes
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
    const { distanceM, energieKwh, debut, dernierPoint, dernierePuissance } = this;
    return { distanceM, energieKwh, debut, dernierPoint, dernierePuissance };
  }
}

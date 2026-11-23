// Mode démonstration : rejoue un vrai itinéraire (Fontainebleau → Auxerre) et simule la Tesla.
// Permet de tester tout le tableau de bord sur le Mac, sans rouler.
// Les appels OpenStreetMap et météo restent réels, sur les positions simulées.
import { ROUTE_DEMO } from './route-demo.js';
import { distanceM, bearingDeg } from '../lib/geo.js';

const ACCELERATION_MAX = 1.5; // m/s²
const PAS_S = 1; // une position par seconde, comme un vrai GPS
const CAPACITE_KWH = 75; // capacité utile approximative d'une Model Y Grande Autonomie

/** Modèle simplifié de consommation d'une Model Y (kW). */
export function puissanceModelY(vitesse, acceleration, ventDeFaceMs = 0) {
  const masse = 2000, cx = 0.23, surface = 2.66, crr = 0.011, air = 1.2;
  const vAir = vitesse + ventDeFaceMs;
  const resistance = 0.5 * air * cx * surface * vAir * Math.abs(vAir) + crr * masse * 9.81;
  const roues = (resistance + masse * acceleration) * vitesse; // W
  const batterie = roues > 0 ? roues / 0.88 : roues * 0.7; // rendement moteur / récupération
  return batterie / 1000 + 0.6; // + équipements (clim, électronique)
}

export class Simulation {
  /** @param accelere facteur de vitesse de lecture (1 = temps réel) */
  constructor(accelere = 1) {
    this.accelere = accelere;
    this.ventDeFaceMs = 0; // mis à jour par l'application à partir de la vraie météo
    this.etat = 'simulation';
  }

  start(onFix, onTesla) {
    // Position le long de l'itinéraire : index du segment + distance parcourue dans ce segment.
    let i = 0, dansSegment = 0, vitesse = 0, t = Date.now();
    let batterie = 82; // % au départ
    let derniereBatterie = -Infinity;
    const tick = () => {
      if (i >= ROUTE_DEMO.length - 1) { i = 0; dansSegment = 0; } // boucle à la fin
      const [lat1, lon1, vCible] = ROUTE_DEMO[i];
      const [lat2, lon2] = ROUTE_DEMO[i + 1];
      const a = { lat: lat1, lon: lon1 }, b = { lat: lat2, lon: lon2 };

      const cible = vCible * 1.08; // OSRM est prudent : on roule un peu plus vite
      const acceleration = Math.max(-ACCELERATION_MAX, Math.min(ACCELERATION_MAX, (cible - vitesse) / PAS_S));
      vitesse = Math.max(0, vitesse + acceleration * PAS_S);
      dansSegment += vitesse * PAS_S;

      let longueur = distanceM(a, b);
      while (dansSegment > longueur && i < ROUTE_DEMO.length - 2) {
        dansSegment -= longueur;
        i++;
        longueur = distanceM({ lat: ROUTE_DEMO[i][0], lon: ROUTE_DEMO[i][1] }, { lat: ROUTE_DEMO[i + 1][0], lon: ROUTE_DEMO[i + 1][1] });
      }
      const p1 = { lat: ROUTE_DEMO[i][0], lon: ROUTE_DEMO[i][1] };
      const p2 = { lat: ROUTE_DEMO[i + 1][0], lon: ROUTE_DEMO[i + 1][1] };
      const f = longueur ? Math.min(1, dansSegment / longueur) : 0;
      t += PAS_S * 1000;

      onFix({
        lat: p1.lat + (p2.lat - p1.lat) * f,
        lon: p1.lon + (p2.lon - p1.lon) * f,
        accuracy: 5,
        speed: vitesse,
        heading: bearingDeg(p1, p2),
        t,
      });

      const kmh = vitesse * 3.6;
      const puissance = puissanceModelY(vitesse, acceleration, this.ventDeFaceMs);
      batterie -= ((puissance * PAS_S) / 3600 / CAPACITE_KWH) * 100;
      const msg = {
        powerKw: puissance,
        cruiseKmh: kmh > 70 ? Math.round(kmh / 5) * 5 : null, // régulateur engagé au-dessus de 70 km/h
        t,
      };
      if (t - derniereBatterie >= 60000) {
        msg.batteryPct = Math.round(batterie); // comme la Tesla réglée à 1 envoi par minute
        derniereBatterie = t;
      }
      onTesla(msg);
    };
    this.timer = setInterval(tick, (PAS_S * 1000) / this.accelere);
  }

  stop() {
    clearInterval(this.timer);
  }
}

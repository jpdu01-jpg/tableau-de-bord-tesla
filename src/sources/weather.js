// Vent et température depuis Open-Meteo (gratuit, sans clé).
// Mis à jour toutes les 10 minutes, ou après 10 km parcourus.
import { distanceM } from '../lib/geo.js';

const INTERVALLE_MS = 10 * 60 * 1000;
const DISTANCE_M = 10000;

export class WeatherService {
  constructor() {
    this.donnees = null; // { ventVientDe, vitesseVent, rafales, temperature }
    this.position = null;
    this.date = 0;
    this.enCours = false;
    this.etat = 'attente';
  }

  update(pos) {
    const perime = Date.now() - this.date > INTERVALLE_MS;
    const loin = this.position && distanceM(this.position, pos) > DISTANCE_M;
    if ((perime || loin || !this.position) && !this.enCours) this.#telecharger(pos);
    return this.donnees;
  }

  async #telecharger(pos) {
    this.enCours = true;
    this.date = Date.now(); // évite de relancer en boucle en cas d'erreur
    const url =
      'https://api.open-meteo.com/v1/forecast' +
      `?latitude=${pos.lat.toFixed(3)}&longitude=${pos.lon.toFixed(3)}` +
      '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m,temperature_2m&wind_speed_unit=kmh';
    try {
      const rep = await fetch(url, { signal: AbortSignal.timeout(15000) });
      if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
      const c = (await rep.json()).current;
      this.donnees = {
        ventVientDe: c.wind_direction_10m,
        vitesseVent: c.wind_speed_10m,
        rafales: c.wind_gusts_10m,
        temperature: c.temperature_2m,
      };
      this.position = { lat: pos.lat, lon: pos.lon };
      this.etat = 'ok';
    } catch (e) {
      console.warn('Météo indisponible :', e.message);
      this.etat = 'erreur';
      this.date = Date.now() - INTERVALLE_MS + 60000; // nouvel essai dans 1 minute
    } finally {
      this.enCours = false;
    }
  }
}

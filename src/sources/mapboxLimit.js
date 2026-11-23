// Limitation de vitesse via Mapbox Map Matching (source principale quand une clé est enregistrée).
// Une requête au plus toutes les 3 secondes, uniquement en roulant : ~38 000 requêtes/mois pour 4 voyages de 8 h,
// sous le quota gratuit de 100 000. Un compteur mensuel coupe Mapbox à 90 000 (OpenStreetMap prend alors le relais).
import { ajouterATrace, urlMapMatching, limiteFinDeTrace, compterRequete, quotaAtteint } from '../lib/mapbox.js';

const INTERVALLE_MS = 3000;
const VALIDITE_MS = 30000; // au-delà, une limitation non rafraîchie n'est plus affichée
const CLE_JETON = 'mapbox-jeton';
const CLE_COMPTEUR = 'mapbox-compteur';

export const lireJeton = () => localStorage.getItem(CLE_JETON) || '';
export const enregistrerJeton = (jeton) =>
  jeton ? localStorage.setItem(CLE_JETON, jeton.trim()) : localStorage.removeItem(CLE_JETON);
export const lireCompteur = () => JSON.parse(localStorage.getItem(CLE_COMPTEUR) || 'null');

export class MapboxLimitService {
  constructor() {
    this.trace = [];
    this.resultat = null; // { limit, name, recuLe }
    this.derniereRequete = 0;
    this.enCours = false;
    this.etat = 'attente'; // attente | ok | erreur
  }

  /** Mapbox est-il utilisable (clé présente, quota non atteint, clé non refusée) ? */
  get disponible() {
    return !!lireJeton() && !quotaAtteint(lireCompteur(), Date.now()) && this.etat !== 'refuse';
  }

  /** À appeler à chaque position. Retourne la dernière limitation connue { limit, ref, name } ou null. */
  update(p) {
    this.trace = ajouterATrace(this.trace, p);
    const enMouvement = (p.speed ?? 0) > 2;
    if (enMouvement && this.trace.length >= 2 && !this.enCours && Date.now() - this.derniereRequete >= INTERVALLE_MS) {
      this.#demander([...this.trace]);
    }
    if (!this.resultat || Date.now() - this.resultat.recuLe > VALIDITE_MS) return null;
    return { limit: this.resultat.limit, ref: null, name: this.resultat.name };
  }

  async #demander(trace) {
    this.enCours = true;
    this.derniereRequete = Date.now();
    localStorage.setItem(CLE_COMPTEUR, JSON.stringify(compterRequete(lireCompteur(), Date.now())));
    try {
      const rep = await fetch(urlMapMatching(trace, lireJeton()), { signal: AbortSignal.timeout(8000) });
      if (rep.status === 401 || rep.status === 403) {
        this.etat = 'refuse'; // clé invalide ou restreinte : on bascule sur OpenStreetMap
        console.warn('Clé Mapbox refusée');
        return;
      }
      const json = await rep.json();
      const r = limiteFinDeTrace(json);
      if (r) this.resultat = { ...r, recuLe: Date.now() };
      this.etat = 'ok';
    } catch (e) {
      console.warn('Mapbox indisponible :', e.message);
      this.etat = 'erreur';
    } finally {
      this.enCours = false;
    }
  }
}

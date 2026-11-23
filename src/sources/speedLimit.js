// Limitation de vitesse depuis OpenStreetMap (service Overpass, gratuit).
//
// Les serveurs Overpass publics sont gratuits mais parfois lents (jusqu'à 20 s) ou saturés.
// Pour ne jamais être pris de court, on télécharge une zone de 1,2 km de rayon centrée 600 m DEVANT
// la voiture, puis on cherche localement la route la plus proche à chaque position GPS.
// On lance le téléchargement suivant bien avant de sortir de la zone, et on garde l'ancienne zone
// tant que la nouvelle n'est pas arrivée.
import { distanceM, destination } from '../lib/geo.js';
import { matchWay } from '../lib/maxspeed.js';

// Plusieurs serveurs publics : si l'un est saturé, on essaie le suivant.
const SERVEURS = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const RAYON_M = 1200;
const AVANCE_M = 600; // centre de la zone placé devant la voiture
const DISTANCE_RECHARGEMENT_M = 600; // on recharge quand on s'éloigne de 600 m du centre
const DELAI_MIN_ENTRE_REQUETES_MS = 15000;
const DELAI_MAX_REPONSE_MS = 30000;
const TYPES_ROUTES =
  'motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link';

export class SpeedLimitService {
  constructor() {
    this.ways = [];
    this.centre = null;
    this.enCours = false;
    this.derniereRequete = 0;
    this.serveur = 0;
    this.etat = 'attente'; // attente | ok | erreur
  }

  /** À appeler à chaque position. Retourne { limit, ref, name } ou null. */
  update(pos, cap) {
    const loin = !this.centre || distanceM(this.centre, pos) > DISTANCE_RECHARGEMENT_M;
    const autorise = Date.now() - this.derniereRequete > DELAI_MIN_ENTRE_REQUETES_MS;
    if (loin && autorise && !this.enCours) {
      const centre = cap == null ? pos : destination(pos, cap, AVANCE_M);
      this.#telecharger(centre);
    }

    const r = matchWay(this.ways, pos, cap);
    if (!r) return null;
    return { limit: r.limit, ref: r.way.tags.ref || null, name: r.way.tags.name || null };
  }

  async #telecharger(centre) {
    this.enCours = true;
    this.derniereRequete = Date.now();
    if (this.etat !== 'ok') this.etat = 'attente';
    const requete = `[out:json][timeout:25];way(around:${RAYON_M},${centre.lat.toFixed(5)},${centre.lon.toFixed(5)})[highway~"^(${TYPES_ROUTES})$"];out tags geom;`;
    for (let essai = 0; essai < SERVEURS.length; essai++) {
      const url = SERVEURS[this.serveur];
      try {
        const rep = await fetch(url, {
          method: 'POST',
          body: new URLSearchParams({ data: requete }),
          signal: AbortSignal.timeout(DELAI_MAX_REPONSE_MS),
        });
        if (!rep.ok) throw new Error(`HTTP ${rep.status}`);
        const json = await rep.json();
        this.ways = json.elements.filter((e) => e.type === 'way' && e.geometry);
        this.centre = centre;
        this.etat = 'ok';
        this.enCours = false;
        return;
      } catch (e) {
        console.warn('Overpass indisponible :', url, e.message);
        this.serveur = (this.serveur + 1) % SERVEURS.length; // on passe au serveur suivant
      }
    }
    // Tous les serveurs ont échoué : on garde l'ancienne zone (encore valable un moment) et on réessaiera.
    this.etat = 'erreur';
    this.enCours = false;
  }
}

// Calculs pour la limitation de vitesse Mapbox (API Map Matching). Fonctions pures, testées dans tests/mapbox.test.js.
//
// Principe : on envoie à Mapbox les dernières positions GPS (la « trace »). Mapbox les recale sur la route
// réellement suivie et renvoie, pour chaque portion, la vitesse maximale (annotation « maxspeed »).
import { distanceM } from './geo.js';

export const TRACE_MAX_POINTS = 8; // positions envoyées à chaque requête
export const TRACE_ESPACEMENT_M = 20; // écart minimal entre deux positions de la trace
export const QUOTA_MENSUEL_MAX = 90000; // sécurité : le gratuit s'arrête à 100 000 requêtes par mois

/** Ajoute une position GPS à la trace si elle est précise et assez loin de la précédente. Renvoie la nouvelle trace. */
export function ajouterATrace(trace, p) {
  if (p.accuracy != null && p.accuracy > 40) return trace;
  const derniere = trace[trace.length - 1];
  if (derniere && distanceM(derniere, p) < TRACE_ESPACEMENT_M) return trace;
  return [...trace, p].slice(-TRACE_MAX_POINTS);
}

/** Construit l'adresse de la requête Map Matching pour une trace (au moins 2 positions). */
export function urlMapMatching(trace, jeton) {
  const coords = trace.map((p) => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';');
  const rayons = trace.map((p) => Math.round(Math.min(25, Math.max(5, p.accuracy ?? 10)))).join(';');
  // Horodatages en secondes, strictement croissants (exigé par Mapbox).
  let precedent = -Infinity;
  const temps = trace.map((p) => (precedent = Math.max(Math.floor(p.t / 1000), precedent + 1))).join(';');
  return (
    `https://api.mapbox.com/matching/v5/mapbox/driving/${coords}` +
    // overview=full est exigé par Mapbox pour obtenir maxspeed (sinon erreur 422 « Overview option must be full »)
    `?annotations=maxspeed&overview=full&tidy=false&radiuses=${rayons}&timestamps=${temps}` +
    `&access_token=${encodeURIComponent(jeton)}`
  );
}

/** Convertit une entrée « maxspeed » de Mapbox en km/h ({speed, unit} | {unknown} | {none}). */
export function parseMapboxMaxspeed(entree) {
  if (!entree || entree.unknown || entree.none || entree.speed == null) return null;
  return entree.unit === 'mph' ? Math.round(entree.speed * 1.609344) : entree.speed;
}

/**
 * Extrait la limitation à la position la plus récente (fin de la trace) d'une réponse Map Matching.
 * @returns { limit, name } ou null si la trace n'a pas pu être recalée ou si la confiance est trop faible.
 */
export function limiteFinDeTrace(reponse, confianceMin = 0.1) {
  if (reponse?.code !== 'Ok') return null;
  const recalage = reponse.matchings?.[reponse.matchings.length - 1];
  if (!recalage || (recalage.confidence ?? 1) < confianceMin) return null;
  // On remonte depuis la fin jusqu'à trouver une portion avec une valeur.
  const legs = recalage.legs || [];
  for (let i = legs.length - 1; i >= 0; i--) {
    const vitesses = legs[i].annotation?.maxspeed || [];
    for (let j = vitesses.length - 1; j >= 0; j--) {
      if (vitesses[j] && !vitesses[j].unknown) {
        return { limit: parseMapboxMaxspeed(vitesses[j]), name: legs[i].summary || null };
      }
    }
  }
  return { limit: null, name: legs[legs.length - 1]?.summary || null };
}

/** Compteur de requêtes du mois en cours : remis à zéro automatiquement au changement de mois. */
export function compterRequete(compteur, maintenant) {
  const mois = new Date(maintenant).toISOString().slice(0, 7); // « 2026-11 »
  const n = compteur?.mois === mois ? compteur.n : 0;
  return { mois, n: n + 1 };
}

export function quotaAtteint(compteur, maintenant) {
  const mois = new Date(maintenant).toISOString().slice(0, 7);
  return compteur?.mois === mois && compteur.n >= QUOTA_MENSUEL_MAX;
}

// Lecture des limitations de vitesse OpenStreetMap et choix de la route sur laquelle roule la voiture.
// Fonctions pures, testées dans tests/maxspeed.test.js.
import { pointToSegment, angleDiff } from './geo.js';

// Limitations « implicites » utilisées en France quand OSM indique une catégorie au lieu d'un nombre.
const IMPLICITES = {
  'FR:motorway': 130,
  'FR:rural': 80,
  'FR:urban': 50,
  'FR:zone30': 30,
  'FR:zone20': 20,
  'FR:living_street': 20,
  'FR:walk': 6,
};

/** Convertit une valeur OSM « maxspeed » en km/h. Renvoie null si inconnue ou non chiffrée. */
export function parseMaxspeed(valeur) {
  if (valeur == null) return null;
  const v = String(valeur).split(';')[0].trim(); // « 90;110 » : on garde la première valeur
  if (v in IMPLICITES) return IMPLICITES[v];
  const m = v.match(/^(\d+(?:\.\d+)?)\s*(mph)?$/i);
  if (!m) return null; // « none », « signals », « variable »…
  const n = parseFloat(m[1]);
  return m[2] ? Math.round(n * 1.609344) : n;
}

/**
 * Limitation applicable sur une route OSM selon le sens de circulation.
 * @param tags     étiquettes OSM de la route
 * @param sensDirect true si la voiture roule dans le sens de dessin de la route
 */
export function limitForDirection(tags, sensDirect) {
  const specifique = sensDirect ? tags['maxspeed:forward'] : tags['maxspeed:backward'];
  return parseMaxspeed(specifique ?? tags.maxspeed);
}

const SENS_UNIQUE = (tags) =>
  tags.oneway === 'yes' || tags.oneway === '1' || tags.highway === 'motorway' || tags.junction === 'roundabout';

/**
 * Trouve la route la plus probable pour une position et un cap donnés.
 * @param ways    [{ tags, geometry: [{lat, lon}, ...] }] tels que renvoyés par Overpass
 * @param pos     {lat, lon}
 * @param heading cap de la voiture en degrés, ou null s'il est inconnu (voiture arrêtée)
 * @returns { way, limit, distance } ou null si aucune route à moins de distanceMax mètres
 */
export function matchWay(ways, pos, heading, distanceMax = 40) {
  let meilleur = null;
  for (const way of ways) {
    const g = way.geometry || [];
    for (let i = 0; i < g.length - 1; i++) {
      const { distance, bearing } = pointToSegment(pos, g[i], g[i + 1]);
      if (distance > distanceMax) continue;

      // Pénalité si la route ne va pas dans la même direction que la voiture.
      let sensDirect = true;
      let ecart = 0;
      if (heading != null) {
        const direct = Math.abs(angleDiff(heading, bearing));
        const inverse = Math.abs(angleDiff(heading, bearing + 180));
        if (SENS_UNIQUE(way.tags)) {
          ecart = direct; // on ne peut pas rouler à contresens
        } else {
          sensDirect = direct <= inverse;
          ecart = Math.min(direct, inverse);
        }
      }
      const bretelle = /_link$/.test(way.tags.highway || '') ? 8 : 0;
      const score = distance + ecart / 3 + bretelle; // 30° d'écart ≈ 10 m d'éloignement

      if (!meilleur || score < meilleur.score) {
        meilleur = { score, way, distance, sensDirect };
      }
    }
  }
  if (!meilleur) return null;
  return {
    way: meilleur.way,
    distance: meilleur.distance,
    limit: limitForDirection(meilleur.way.tags, meilleur.sensDirect),
  };
}

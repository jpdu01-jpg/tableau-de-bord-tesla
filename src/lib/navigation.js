// Calculs de l'écran de navigation. Fonctions pures, testées dans tests/navigation.test.js.
//
// La Tesla envoie l'itinéraire de son GPS dans le champ RouteLine. Format observé en pratique
// (différent de la documentation, qui parle d'une simple polyligne) :
//   texte base64 → message protobuf → champ n° 1 = polyligne Google, précision 6 (1 µ-degré).
// Par sécurité, on accepte aussi une polyligne en base64 seule, ou une polyligne en clair.

const MILE_KM = 1.609344;

/** Décode une polyligne au format Google (https://developers.google.com/maps/documentation/utilities/polylinealgorithm). */
export function decoderPolyline(texte, precision = 6) {
  const facteur = 10 ** precision;
  const points = [];
  let i = 0, lat = 0, lon = 0;
  const lireNombre = () => {
    let resultat = 0, decalage = 0, octet;
    do {
      if (i >= texte.length) throw new Error('polyligne tronquée');
      octet = texte.charCodeAt(i++) - 63;
      if (octet < 0 || octet > 63) throw new Error('caractère invalide');
      resultat |= (octet & 0x1f) << decalage;
      decalage += 5;
    } while (octet >= 0x20);
    return resultat & 1 ? ~(resultat >> 1) : resultat >> 1;
  };
  while (i < texte.length) {
    lat += lireNombre();
    lon += lireNombre();
    points.push({ lat: lat / facteur, lon: lon / facteur });
  }
  return points;
}

/** Encode une polyligne au format Google (sert aux tests et au mode démo). */
export function encoderPolyline(points, precision = 6) {
  const facteur = 10 ** precision;
  let texte = '', latPrec = 0, lonPrec = 0;
  const ecrire = (n) => {
    let v = n < 0 ? ~(n << 1) : n << 1;
    while (v >= 0x20) {
      texte += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
      v >>= 5;
    }
    texte += String.fromCharCode(v + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * facteur), lon = Math.round(p.lon * facteur);
    ecrire(lat - latPrec);
    ecrire(lon - lonPrec);
    latPrec = lat;
    lonPrec = lon;
  }
  return texte;
}

/** Un tracé est plausible si toutes ses coordonnées sont sur la Terre (évite d'afficher n'importe quoi). */
const plausible = (points) =>
  points.length >= 2 && points.every((p) => Math.abs(p.lat) <= 90 && Math.abs(p.lon) <= 180);

/** Lit le champ n° 1 (texte) d'un message protobuf. Renvoie null s'il est absent. */
function champ1Protobuf(octets) {
  let i = 0;
  const varint = () => {
    let v = 0, mult = 1, o;
    do {
      if (i >= octets.length) throw new Error('protobuf tronqué');
      o = octets[i++];
      v += (o & 0x7f) * mult;
      mult *= 128;
    } while (o & 0x80);
    return v;
  };
  while (i < octets.length) {
    const cle = varint();
    const numero = Math.floor(cle / 8), type = cle % 8;
    if (type === 0) varint();
    else if (type === 1) i += 8;
    else if (type === 5) i += 4;
    else if (type === 2) {
      const longueur = varint();
      const contenu = octets.slice(i, i + longueur);
      i += longueur;
      if (numero === 1) return String.fromCharCode(...contenu);
    } else throw new Error('type protobuf inconnu');
  }
  return null;
}

/** Tracé de l'itinéraire Tesla (champ RouteLine) → [{lat, lon}], ou null si pas d'itinéraire / illisible. */
export function decoderRouteLine(valeur) {
  if (typeof valeur !== 'string' || valeur.length < 4) return null;
  const essais = [];
  try {
    const octets = Uint8Array.from(atob(valeur), (c) => c.charCodeAt(0));
    essais.push(() => champ1Protobuf(octets)); // base64 → protobuf → polyligne
    essais.push(() => String.fromCharCode(...octets)); // base64 → polyligne
  } catch {
    /* pas du base64 */
  }
  essais.push(() => valeur); // polyligne en clair
  for (const essai of essais) {
    try {
      const texte = essai();
      if (!texte) continue;
      const points = decoderPolyline(texte, 6);
      if (plausible(points)) return points;
    } catch {
      /* format suivant */
    }
  }
  return null;
}

/**
 * Convertit les champs Tesla de navigation (unités américaines) en données de l'application.
 * Seuls les champs présents dans `champs` sont renvoyés (la voiture n'envoie que ce qui change).
 * Une valeur null signifie « pas de destination ».
 */
export function navigationDepuisChamps(champs) {
  const d = {};
  if ('DestinationName' in champs) d.destinationNom = champs.DestinationName || null;
  if ('DestinationLocation' in champs) d.destinationPos = champs.DestinationLocation?.lat != null ? champs.DestinationLocation : null;
  if ('RouteLine' in champs) d.trace = decoderRouteLine(champs.RouteLine);
  if ('MinutesToArrival' in champs) d.minutesArrivee = champs.MinutesToArrival;
  if ('MilesToArrival' in champs) d.kmArrivee = champs.MilesToArrival == null ? null : champs.MilesToArrival * MILE_KM;
  if ('RouteTrafficMinutesDelay' in champs) d.retardTraficMin = champs.RouteTrafficMinutesDelay;
  if ('ExpectedEnergyPercentAtTripArrival' in champs) d.batterieArriveePct = champs.ExpectedEnergyPercentAtTripArrival;
  return d;
}

/** Une navigation est en cours si la voiture a une destination ou un itinéraire. */
export const navigationActive = (nav) => Boolean(nav?.destinationNom || nav?.trace?.length);

/**
 * Bascule automatique de l'écran : ouvre la carte quand une destination apparaît, la ferme quand elle disparaît.
 * Entre deux changements, le choix manuel (toucher l'écran) est respecté.
 * Renvoie 'ouvrir', 'fermer' ou null (ne rien changer).
 */
export function basculeAuto(avaitDestination, aDestination) {
  if (!avaitDestination && aDestination) return 'ouvrir';
  if (avaitDestination && !aDestination) return 'fermer';
  return null;
}

/** Heure d'arrivée (Date) à partir de l'heure actuelle (ms) et des minutes restantes. */
export function heureArrivee(maintenantMs, minutes) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  return new Date(maintenantMs + minutes * 60000);
}

/** Zoom de la carte selon la vitesse : proche en ville, plus large sur autoroute. */
export function zoomPourVitesse(kmh) {
  const v = Math.min(Math.max(kmh ?? 0, 0), 150);
  return 16.5 - (v / 150) * 2.5; // 16,5 à l'arrêt → 14 à 150 km/h
}

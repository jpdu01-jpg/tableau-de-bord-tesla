// FICHIER FABRIQUÉ par outils/assembler-worker.py : modifier relais/borne-worker.modele.js ou src/lib/.
// Changement de borne à la voix pour Cloudflare Workers (à copier-coller dans l'éditeur du Worker, voir
// relais/LISEZMOI.md, partie « Changement de borne à la voix »). Appelé par un raccourci Siri.
//
//   « Dis Siri, change de borne » → « Quel réseau ? » → « Electra »
//   → POST /proposer { reseau: "Electra" } : lit le prochain arrêt de la Tesla (télémétrie en cache : gratuit, ne
//     réveille pas la voiture), choisit la meilleure borne, renvoie la phrase que Siri lit
//   → « Oui » → POST /envoyer { borne: "lat,lon" } : envoie la nouvelle destination au GPS de la Tesla.
//   Sans navigation en cours : la borne est cherchée autour de la voiture, dont la position est demandée une fois
//   (vehicle_data, quelques crédits ; ne réveille pas la voiture : si elle dort, rien n'est proposé).
//
// Sécurité : ce Worker PEUT envoyer une commande à la voiture. Il est donc limité à la navigation, et seulement vers
// une borne de la liste data/bornes.json (impossible d'envoyer la voiture ailleurs). Chaque appel doit porter le mot
// de passe (en-tête « Authorization: Bearer … »). Le jeton Teslemetry et le mot de passe ne sont PAS dans ce code :
// ce sont des secrets du Worker dans Cloudflare (TESLEMETRY_JETON, MOT_DE_PASSE).

const ADRESSE_BORNES = 'https://jpdu01-jpg.github.io/tableau-de-bord-tesla/data/bornes.json'; // publié avec l'app
const API = 'https://api.teslemetry.com';
// Ordre de la commande de navigation :
//   1 = remplacer tout le trajet (la suite du voyage est à reprogrammer à la borne) ;
//   2 = ajouter comme prochain arrêt (la suite est gardée, mais l'ancien arrêt aussi : à supprimer sur l'écran).
const ORDRE = 1;

// ===== copie de src/lib/geo.js (ne pas modifier ici) =====
// Calculs géographiques de base. Fonctions pures, testées dans tests/geo.test.js.

const R_TERRE = 6371008.8; // rayon moyen de la Terre, en mètres
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distance en mètres entre deux points {lat, lon} (formule de haversine). */
function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap en degrés (0 = nord, 90 = est) pour aller de a vers b. */
function bearingDeg(a, b) {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const dλ = rad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalize360(deg(Math.atan2(y, x)));
}

/** Point situé à `distance` mètres de `depart`, dans la direction `cap` (degrés). */
function destination(depart, cap, distance) {
  const δ = distance / R_TERRE;
  const θ = rad(cap);
  const φ1 = rad(depart.lat);
  const λ1 = rad(depart.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lon: deg(λ2) };
}

/** Ramène un angle dans [0, 360[. */
function normalize360(a) {
  return ((a % 360) + 360) % 360;
}

/** Écart signé de a vers b, dans ]-180, 180]. */
function angleDiff(a, b) {
  const d = normalize360(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Distance en mètres entre un point p et le segment [a, b], et cap du segment (a → b).
 * Utilise une projection plane locale : précise à quelques centimètres sur les petites distances.
 */
function pointToSegment(p, a, b) {
  const kx = Math.cos(rad(p.lat)) * rad(1) * R_TERRE; // mètres par degré de longitude
  const ky = rad(1) * R_TERRE; // mètres par degré de latitude
  const ax = (a.lon - p.lon) * kx, ay = (a.lat - p.lat) * ky;
  const bx = (b.lon - p.lon) * kx, by = (b.lat - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  const cx = ax + t * dx, cy = ay + t * dy;
  return { distance: Math.hypot(cx, cy), bearing: bearingDeg(a, b) };
}
// ===== copie de src/lib/navigation.js (ne pas modifier ici) =====
// Calculs de l'écran de navigation. Fonctions pures, testées dans tests/navigation.test.js.
//
// La Tesla envoie l'itinéraire de son GPS dans le champ RouteLine. Format observé en pratique
// (différent de la documentation, qui parle d'une simple polyligne) :
//   texte base64 → message protobuf → champ n° 1 = polyligne Google, précision 6 (1 µ-degré).
// Par sécurité, on accepte aussi une polyligne en base64 seule, ou une polyligne en clair.

const MILE_KM = 1.609344;

/** Décode une polyligne au format Google (https://developers.google.com/maps/documentation/utilities/polylinealgorithm). */
function decoderPolyline(texte, precision = 6) {
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
function encoderPolyline(points, precision = 6) {
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
function decoderRouteLine(valeur) {
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
function navigationDepuisChamps(champs) {
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
const navigationActive = (nav) => Boolean(nav?.destinationNom || nav?.trace?.length);

/**
 * Bascule automatique de l'écran : ouvre la carte quand une destination apparaît, la ferme quand elle disparaît.
 * Entre deux changements, le choix manuel (toucher l'écran) est respecté.
 * Renvoie 'ouvrir', 'fermer' ou null (ne rien changer).
 */
function basculeAuto(avaitDestination, aDestination) {
  if (!avaitDestination && aDestination) return 'ouvrir';
  if (avaitDestination && !aDestination) return 'fermer';
  return null;
}

/** Heure d'arrivée (Date) à partir de l'heure actuelle (ms) et des minutes restantes. */
function heureArrivee(maintenantMs, minutes) {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return null;
  return new Date(maintenantMs + minutes * 60000);
}

/** Zoom de la carte selon la vitesse : proche en ville, plus large sur autoroute. */
function zoomPourVitesse(kmh) {
  const v = Math.min(Math.max(kmh ?? 0, 0), 150);
  return 16.5 - (v / 150) * 2.5; // 16,5 à l'arrêt → 14 à 150 km/h
}
// ===== copie de src/lib/bornes.js (ne pas modifier ici) =====
// Changement de borne à la voix (raccourci Siri → relais/borne-worker.js) : comprendre la demande, lire la
// navigation de la Tesla, choisir la borne. Fonctions pures, testées dans tests/bornes.test.js.
//
// Ce fichier est aussi recopié dans le Worker (avec geo.js et navigation.js) par outils/assembler-worker.py :
// après une modification, relancer ce script (un test vérifie que la copie est à jour).

const RAYON_KM = 50; // bornes cherchées autour du prochain arrêt (Electra : 5 km d'un Superchargeur en médiane, parfois 40)
const DETOUR_MAX_KM = 30; // au-delà, la borne n'est pas proposée (pas d'aller-retour absurde)
const FACTEUR_ROUTE = 1.3; // une route n'est pas une ligne droite
const MEME_LIEU_KM = 0.3; // la borne déjà prévue n'est pas proposée
const DEVANT_DEG = 60; // sans navigation, en roulant : une borne « devant » est à moins de 60° du cap de la voiture
const ROULE_MPH = 3; // en dessous, la voiture est arrêtée : son cap ne dit pas où elle va

// Ordre de préférence : le réseau demandé, puis ses remplaçants. Partenaires Electra : alliance ChargeLeague.
const PARTENAIRES_ELECTRA = ['ionity', 'atlante'];
const PRIORITES = {
  tesla: [['tesla'], ['electra'], PARTENAIRES_ELECTRA],
  electra: [['electra'], PARTENAIRES_ELECTRA],
  ionity: [['ionity'], ['electra', 'atlante']],
  atlante: [['atlante'], ['electra', 'ionity']],
};
const NOMS_RESEAUX = { tesla: 'Superchargeur Tesla', electra: 'Electra', ionity: 'Ionity', atlante: 'Atlante' };

/** Réseau compris dans une phrase dictée (« Electra », « un superchargeur »…), ou null. */
function comprendreReseau(texte) {
  const t = (texte || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); // sans accents
  if (/tesla|super ?charg/.test(t)) return 'tesla';
  if (/electra|elektra|lectra/.test(t)) return 'electra';
  if (/ionity|ionit/.test(t)) return 'ionity';
  if (/atlant/.test(t)) return 'atlante';
  return null;
}

/**
 * Navigation en cours d'après la télémétrie Teslemetry (GET /api/1/vehicles/{vin}/telemetry) :
 * { data: { DestinationName: { value }, DestinationLocation: { value: { latitude, longitude } }, RouteLine: { value } } }.
 * Renvoie { arret: { nom, lat, lon }, trace } ou null s'il n'y a pas de navigation.
 */
function navigationTeslemetry(reponse) {
  const d = reponse?.data ?? {};
  const nom = d.DestinationName?.value;
  const pos = d.DestinationLocation?.value;
  if (!nom || pos?.latitude == null) return null; // DestinationName vide = pas de destination (la position reste en cache)
  return { arret: { nom, lat: pos.latitude, lon: pos.longitude }, trace: decoderRouteLine(d.RouteLine?.value) };
}

/**
 * Position de la voiture d'après Teslemetry (GET /api/1/vehicles/{vin}/vehicle_data?endpoints=location_data) :
 * { response: { drive_state: { latitude, longitude, heading, speed } } } (vitesse en mph, null à l'arrêt).
 * Renvoie { lat, lon, cap } (cap null à l'arrêt) ou null.
 */
function positionVehicule(reponse) {
  const d = (reponse?.response ?? reponse)?.drive_state;
  if (d?.latitude == null || d?.longitude == null) return null;
  const roule = Number(d.speed) > ROULE_MPH && Number.isFinite(d.heading);
  return { lat: d.latitude, lon: d.longitude, cap: roule ? d.heading : null };
}

/** Distance (km) entre un point et l'itinéraire (polyligne), ou null sans itinéraire. */
function ecartItineraireKm(p, trace) {
  if (!trace || trace.length < 2) return null;
  let min = Infinity;
  for (let i = 1; i < trace.length; i++) min = Math.min(min, pointToSegment(p, trace[i - 1], trace[i]).distance);
  return min / 1000;
}

/**
 * Bornes de remplacement pour le prochain arrêt, la meilleure en tête.
 * Réseaux dans l'ordre de PRIORITES[reseau] : on ne passe aux suivants que si aucun ne convient dans le rayon.
 * Dans un même groupe : le plus petit détour estimé (aller-retour depuis l'itinéraire), puis le plus proche de l'arrêt.
 * Une borne dont le détour dépasse DETOUR_MAX_KM n'est jamais proposée.
 * @returns [{ ...borne, distanceArretKm, detourKm }]
 */
function choisirBornes(bornes, { reseau, arret, trace = null, rayonKm = RAYON_KM, detourMaxKm = DETOUR_MAX_KM }) {
  for (const groupe of PRIORITES[reseau] ?? [[reseau]]) {
    const candidates = bornes
      .filter((b) => groupe.includes(b.reseau))
      .map((b) => {
        const distanceArretKm = distanceM(arret, b) / 1000;
        const ecart = ecartItineraireKm(b, trace) ?? distanceArretKm;
        return { ...b, distanceArretKm, detourKm: 2 * ecart * FACTEUR_ROUTE };
      })
      .filter((b) => b.distanceArretKm <= rayonKm && b.distanceArretKm > MEME_LIEU_KM && b.detourKm <= detourMaxKm)
      .sort((a, b) => a.detourKm - b.detourKm || a.distanceArretKm - b.distanceArretKm);
    if (candidates.length) return candidates;
  }
  return [];
}

/**
 * Sans navigation : bornes autour de la voiture, la meilleure en tête.
 * Réseaux dans l'ordre de PRIORITES[reseau] (comme choisirBornes). En roulant, pas de demi-tour : un réseau de
 * remplacement qui a une borne devant passe avant le réseau demandé qui n'en a que derrière. Dans un groupe : celles
 * devant d'abord, puis la plus proche.
 * @returns [{ ...borne, distanceKm, devant }] (devant : true, false, ou null à l'arrêt)
 */
function bornesAutour(bornes, { reseau, position, rayonKm = RAYON_KM }) {
  const cap = position.cap ?? null;
  const groupes = (PRIORITES[reseau] ?? [[reseau]]).map((groupe) => bornes
    .filter((b) => groupe.includes(b.reseau))
    .map((b) => ({ ...b, distanceKm: distanceM(position, b) / 1000,
      devant: cap == null ? null : Math.abs(angleDiff(cap, bearingDeg(position, b))) <= DEVANT_DEG }))
    .filter((b) => b.distanceKm <= rayonKm && b.distanceKm > MEME_LIEU_KM)
    .sort((a, b) => (b.devant === true) - (a.devant === true) || a.distanceKm - b.distanceKm));
  return groupes.find((g) => g.some((b) => b.devant === true)) ?? groupes.find((g) => g.length) ?? [];
}

const km = (v) => (v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v)));

/** Phrase lue par Siri pour proposer une borne. */
function phraseProposition(b, demande) {
  const remplacement = b.reseau !== demande ? `Pas de borne ${NOMS_RESEAUX[demande]} proche. ` : '';
  const detour = b.detourKm < 1 ? 'sans détour' : `détour d'environ ${km(b.detourKm)} kilomètres`;
  return `${remplacement}${NOMS_RESEAUX[b.reseau]} ${b.nom}, ${b.kw} kilowatts, à ${km(b.distanceArretKm)} kilomètres de l'arrêt prévu, ${detour}. Je l'envoie à la voiture ?`;
}

/** Phrase lue par Siri pour proposer une borne autour de la voiture (pas de navigation en cours). */
function phraseAutour(b, demande) {
  const remplacement = b.reseau !== demande ? `Pas de borne ${NOMS_RESEAUX[demande]} proche. ` : '';
  const ou = b.devant === true ? ' devant toi' : b.devant === false ? ' mais pas dans ta direction' : '';
  return `${remplacement}${NOMS_RESEAUX[b.reseau]} ${b.nom}, ${b.kw} kilowatts, à ${km(b.distanceKm)} kilomètres à vol d'oiseau${ou}. Je l'envoie à la voiture ?`;
}

/** Borne connue située à moins de 100 m de la position demandée (le Worker n'envoie que des bornes de la liste). */
const borneConnue = (bornes, p) => bornes.find((b) => distanceM(b, p) < 100) ?? null;

async function motDePasseValide(requete, attendu) {
  const recu = (requete.headers.get('Authorization') || '').replace(/^Bearer /, '');
  // Comparaison à durée constante (des empreintes de même longueur) : ne laisse pas deviner le mot de passe.
  const empreinte = async (t) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  const [a, b] = await Promise.all([empreinte(recu), empreinte(attendu)]);
  return recu.length > 0 && crypto.subtle.timingSafeEqual(a, b);
}

async function teslemetry(env, chemin, options = {}) {
  const rep = await fetch(API + chemin, {
    ...options,
    headers: { Authorization: `Bearer ${env.TESLEMETRY_JETON}`, 'Content-Type': 'application/json' },
  });
  if (rep.status === 401) throw new Error('le jeton Teslemetry est refusé');
  if (rep.status === 408) throw new Error('la Tesla est endormie, elle ne donne pas sa position');
  if (!rep.ok) throw new Error(`Teslemetry a répondu ${rep.status}`);
  return rep.json();
}

async function premierVin(env) {
  const vin = Object.keys((await teslemetry(env, '/api/metadata')).vehicles || {})[0];
  if (!vin) throw new Error('aucune voiture sur le compte Teslemetry');
  return vin;
}

async function lireBornes() {
  const rep = await fetch(ADRESSE_BORNES, { cf: { cacheTtl: 86400 } }); // gardée un jour en cache
  if (!rep.ok) throw new Error('liste des bornes illisible');
  return rep.json();
}

async function proposer(env, { reseau: texte, rang = 0 }) {
  const reseau = comprendreReseau(texte);
  if (!reseau) return { ok: false, texte: 'Je n\'ai pas compris le réseau. Dis Tesla, Electra, Ionity ou Atlante.' };
  const vin = await premierVin(env);
  const champs = encodeURIComponent('DestinationName;DestinationLocation;RouteLine');
  const telemetrie = await teslemetry(env, `/api/1/vehicles/${vin}/telemetry?fields=${champs}`);
  const nav = navigationTeslemetry(telemetrie.response ?? telemetrie);
  if (!nav) return proposerAutour(env, vin, reseau, rang);
  const b = choisirBornes(await lireBornes(), { reseau, arret: nav.arret, trace: nav.trace })[Number(rang) || 0];
  if (!b) {
    return { ok: false, texte: rang ? 'Je n\'ai pas d\'autre borne à proposer.'
      : `Aucune borne ${NOMS_RESEAUX[reseau]} ni partenaire près de l'arrêt prévu sans un détour de plus de ${DETOUR_MAX_KM} kilomètres.` };
  }
  return { ok: true, texte: phraseProposition(b, reseau), borne: `${b.lat},${b.lon}`, nom: `${NOMS_RESEAUX[b.reseau]} ${b.nom}` };
}

// Pas de navigation : borne autour de la voiture. Sa position n'est pas dans la télémétrie diffusée (champ facturé à
// chaque signal) : on la demande une seule fois, ici. Pas de réveil : si la voiture dort, Teslemetry répond 408.
async function proposerAutour(env, vin, reseau, rang) {
  const position = positionVehicule(await teslemetry(env, `/api/1/vehicles/${vin}/vehicle_data?endpoints=location_data`));
  if (!position) return { ok: false, texte: 'Pas de navigation en cours, et la Tesla ne donne pas sa position.' };
  const b = bornesAutour(await lireBornes(), { reseau, position })[Number(rang) || 0];
  if (!b) {
    return { ok: false, texte: rang ? 'Je n\'ai pas d\'autre borne à proposer.'
      : `Aucune borne ${NOMS_RESEAUX[reseau]} ni partenaire à moins de ${RAYON_KM} kilomètres.` };
  }
  return { ok: true, texte: phraseAutour(b, reseau), borne: `${b.lat},${b.lon}`, nom: `${NOMS_RESEAUX[b.reseau]} ${b.nom}` };
}

async function envoyer(env, { borne }) {
  const [lat, lon] = String(borne || '').split(',').map(Number);
  const b = Number.isFinite(lat) && Number.isFinite(lon) ? borneConnue(await lireBornes(), { lat, lon }) : null;
  if (!b) return { ok: false, texte: 'Cette borne n\'est pas dans la liste : rien n\'a été envoyé.' };
  const vin = await premierVin(env);
  const r = await teslemetry(env, `/api/1/vehicles/${vin}/command/navigation_gps_request`, {
    method: 'POST',
    body: JSON.stringify({ lat: b.lat, lon: b.lon, order: ORDRE }),
  });
  if (r.response?.result === false) return { ok: false, texte: `La Tesla a refusé : ${r.response.reason || 'raison inconnue'}.` };
  return { ok: true, texte: `C'est envoyé : la Tesla part vers ${NOMS_RESEAUX[b.reseau]} ${b.nom}.` };
}

export default {
  async fetch(requete, env) {
    const json = (donnees, status = 200) =>
      new Response(JSON.stringify(donnees), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!env.MOT_DE_PASSE || !env.TESLEMETRY_JETON) {
      return json({ ok: false, texte: 'Worker incomplet : ajouter les secrets MOT_DE_PASSE et TESLEMETRY_JETON.' }, 500);
    }
    if (requete.method !== 'POST') return json({ ok: false, texte: 'Méthode refusée' }, 405);
    if (!(await motDePasseValide(requete, env.MOT_DE_PASSE))) return json({ ok: false, texte: 'Mot de passe refusé.' }, 401);
    const corps = await requete.json().catch(() => ({}));
    try {
      const chemin = new URL(requete.url).pathname;
      if (chemin === '/proposer') return json(await proposer(env, corps));
      if (chemin === '/envoyer') return json(await envoyer(env, corps));
      return json({ ok: false, texte: 'Adresse inconnue' }, 404);
    } catch (e) {
      return json({ ok: false, texte: `Erreur : ${e.message}.` }); // lu par Siri
    }
  },
};

// Changement de borne à la voix (raccourci Siri → relais/borne-worker.js) : comprendre la demande, lire la
// navigation de la Tesla, choisir la borne. Fonctions pures, testées dans tests/bornes.test.js.
//
// Ce fichier est aussi recopié dans le Worker (avec geo.js et navigation.js) par outils/assembler-worker.py :
// après une modification, relancer ce script (un test vérifie que la copie est à jour).
import { distanceM, pointToSegment, bearingDeg, angleDiff } from './geo.js';
import { decoderRouteLine } from './navigation.js';

export const RAYON_KM = 50; // bornes cherchées autour du prochain arrêt (Electra : 5 km d'un Superchargeur en médiane, parfois 40)
export const DETOUR_MAX_KM = 30; // au-delà, la borne n'est pas proposée (pas d'aller-retour absurde)
const FACTEUR_ROUTE = 1.3; // une route n'est pas une ligne droite
const MEME_LIEU_KM = 0.3; // la borne déjà prévue n'est pas proposée
const DEVANT_DEG = 60; // sans navigation, en roulant : une borne « devant » est à moins de 60° du cap de la voiture
const ROULE_MPH = 3; // en dessous, la voiture est arrêtée : son cap ne dit pas où elle va

// Ordre de préférence : le réseau demandé, puis ses remplaçants. Partenaires Electra : alliance ChargeLeague.
export const PARTENAIRES_ELECTRA = ['ionity', 'atlante'];
export const PRIORITES = {
  tesla: [['tesla'], ['electra'], PARTENAIRES_ELECTRA],
  electra: [['electra'], PARTENAIRES_ELECTRA],
  ionity: [['ionity'], ['electra', 'atlante']],
  atlante: [['atlante'], ['electra', 'ionity']],
};
export const NOMS_RESEAUX = { tesla: 'Superchargeur Tesla', electra: 'Electra', ionity: 'Ionity', atlante: 'Atlante' };

/** Réseau compris dans une phrase dictée (« Electra », « un superchargeur »…), ou null. */
export function comprendreReseau(texte) {
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
export function navigationTeslemetry(reponse) {
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
export function positionVehicule(reponse) {
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
export function choisirBornes(bornes, { reseau, arret, trace = null, rayonKm = RAYON_KM, detourMaxKm = DETOUR_MAX_KM }) {
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
export function bornesAutour(bornes, { reseau, position, rayonKm = RAYON_KM }) {
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
export function phraseProposition(b, demande) {
  const remplacement = b.reseau !== demande ? `Pas de borne ${NOMS_RESEAUX[demande]} proche. ` : '';
  const detour = b.detourKm < 1 ? 'sans détour' : `détour d'environ ${km(b.detourKm)} kilomètres`;
  return `${remplacement}${NOMS_RESEAUX[b.reseau]} ${b.nom}, ${b.kw} kilowatts, à ${km(b.distanceArretKm)} kilomètres de l'arrêt prévu, ${detour}. Je l'envoie à la voiture ?`;
}

/** Phrase lue par Siri pour proposer une borne autour de la voiture (pas de navigation en cours). */
export function phraseAutour(b, demande) {
  const remplacement = b.reseau !== demande ? `Pas de borne ${NOMS_RESEAUX[demande]} proche. ` : '';
  const ou = b.devant === true ? ' devant toi' : b.devant === false ? ' mais pas dans ta direction' : '';
  return `${remplacement}${NOMS_RESEAUX[b.reseau]} ${b.nom}, ${b.kw} kilowatts, à ${km(b.distanceKm)} kilomètres à vol d'oiseau${ou}. Je l'envoie à la voiture ?`;
}

/** Borne connue située à moins de 100 m de la position demandée (le Worker n'envoie que des bornes de la liste). */
export const borneConnue = (bornes, p) => bornes.find((b) => distanceM(b, p) < 100) ?? null;

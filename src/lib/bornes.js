// Changement de borne à la voix (raccourci Siri → relais/borne-worker.js) : comprendre la demande, lire la
// navigation de la Tesla, choisir la borne. Fonctions pures, testées dans tests/bornes.test.js.
//
// Ce fichier est aussi recopié dans le Worker (avec geo.js et navigation.js) par outils/assembler-worker.py :
// après une modification, relancer ce script (un test vérifie que la copie est à jour).
import { distanceM, pointToSegment } from './geo.js';
import { decoderRouteLine } from './navigation.js';

export const RAYON_KM = 50; // bornes cherchées autour du prochain arrêt (Electra : 5 km d'un Superchargeur en médiane, parfois 40)
export const DETOUR_MAX_KM = 30; // au-delà, la borne n'est pas proposée (pas d'aller-retour absurde)
const FACTEUR_ROUTE = 1.3; // une route n'est pas une ligne droite
const MEME_LIEU_KM = 0.3; // la borne déjà prévue n'est pas proposée

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

const km = (v) => (v < 10 ? v.toFixed(1).replace('.', ',') : String(Math.round(v)));

/** Phrase lue par Siri pour proposer une borne. */
export function phraseProposition(b, demande) {
  const remplacement = b.reseau !== demande ? `Pas de borne ${NOMS_RESEAUX[demande]} proche. ` : '';
  const detour = b.detourKm < 1 ? 'sans détour' : `détour d'environ ${km(b.detourKm)} kilomètres`;
  return `${remplacement}${NOMS_RESEAUX[b.reseau]} ${b.nom}, ${b.kw} kilowatts, à ${km(b.distanceArretKm)} kilomètres de l'arrêt prévu, ${detour}. Je l'envoie à la voiture ?`;
}

/** Borne connue située à moins de 100 m de la position demandée (le Worker n'envoie que des bornes de la liste). */
export const borneConnue = (bornes, p) => bornes.find((b) => distanceM(b, p) < 100) ?? null;

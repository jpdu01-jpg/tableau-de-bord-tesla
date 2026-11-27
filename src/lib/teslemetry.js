// Décodage du flux temps réel Teslemetry (Server-Sent Events). Fonctions pures, testées dans tests/teslemetry.test.js.
//
// Teslemetry reçoit lui-même la télémétrie de la voiture (sa propre configuration, distincte de MyTeslaMate) et la
// redistribue à qui la demande, sans limite d'abonnés : aucun conflit avec TeslaMate. Le streaming est gratuit.
// Flux : GET https://api.teslemetry.com/sse/{VIN}?token=…&topics=data,state  (format « Teslemetry ») :
//   event: data   → { vin, createdAt, isCache, data: { VehicleSpeed: 34.8, Location: { latitude, longitude }, … } }
//   event: state  → { vin, createdAt, state: 'online' | 'asleep' | 'offline' }
// Une valeur null = « invalide » (ex. pas de destination). Unités américaines (mph, miles), comme Tesla.

/** Champs à cocher dans la console Teslemetry : la navigation, plus de quoi remplacer le boîtier s'il ne répond pas. */
export const CHAMPS_TESLEMETRY = [
  'DestinationName', 'DestinationLocation', 'RouteLine', 'MinutesToArrival', 'MilesToArrival',
  'RouteTrafficMinutesDelay', 'ExpectedEnergyPercentAtTripArrival',
  'BatteryLevel', 'PackVoltage', 'PackCurrent',
  'Gear', // rapport de boîte : la mise en P coupe les trajets même sans boîtier (quelques signaux par trajet)
];

// Au démarrage, Teslemetry renvoie d'abord les dernières valeurs connues (cache). Au-delà de cet âge, elles ne
// décrivent plus le trajet en cours (ex. destination d'hier) : on les ignore.
export const AGE_MAX_CACHE_MS = 10 * 60000;

const PREFIXES = { Gear: 'ShiftState' }; // « ShiftStateD » → « D »

/** Met une valeur Teslemetry au format commun de l'app (positions en { lat, lon }, rapport en lettre). */
export function valeurTeslemetry(nom, v) {
  if (v == null) return null;
  if (typeof v === 'object' && 'latitude' in v) return { lat: v.latitude, lon: v.longitude };
  const prefixe = PREFIXES[nom];
  if (prefixe && typeof v === 'string' && v.startsWith(prefixe)) return v.slice(prefixe.length) || null;
  return v;
}

/**
 * Interprète un événement du flux pour notre voiture.
 * @returns { type: 'donnees', champs, signaux, t, cache } | { type: 'etat', etat } | { type: 'perime' } | { type: 'autre' }
 */
export function interpreterTeslemetry(texte, vin, maintenantMs) {
  let m;
  try {
    m = JSON.parse(texte);
  } catch {
    return { type: 'autre' };
  }
  if (!m || (m.vin && m.vin !== vin)) return { type: 'autre' };
  const t = Date.parse(m.createdAt) || maintenantMs;
  if (m.state) return { type: 'etat', etat: m.state };
  if (!m.data || typeof m.data !== 'object') return { type: 'autre' };
  if (m.isCache && maintenantMs - t > AGE_MAX_CACHE_MS) return { type: 'perime' };
  const champs = {};
  for (const [nom, v] of Object.entries(m.data)) champs[nom] = valeurTeslemetry(nom, v);
  return { type: 'donnees', champs, signaux: Object.keys(champs).length, t, cache: Boolean(m.isCache) };
}

/** Résume la configuration Teslemetry de la voiture (GET /api/config/{vin}) : { nbChamps, manquants, allocationPct }. */
export function resumerConfigTeslemetry(config) {
  const champs = config?.fields;
  if (!champs || typeof champs !== 'object') return null;
  return {
    nbChamps: Object.keys(champs).length,
    manquants: CHAMPS_TESLEMETRY.filter((c) => !(c in champs)),
    allocationPct: config.streaming_allowance_percent ?? null, // part de l'allocation de streaming de l'abonnement
  };
}

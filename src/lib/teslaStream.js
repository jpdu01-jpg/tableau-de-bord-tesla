// Décodage du flux temps réel Tesla au format « streaming » utilisé par TeslaMate et repris par MyTeslaMate.
// Fonctions pures, testées dans tests/teslaStream.test.js.
//
// Protocole (WebSocket wss://streaming.myteslamate.com/streaming/) :
//   1. on envoie { msg_type: 'data:subscribe_oauth', token, value: COLONNES.join(','), tag: VIN }
//   2. on reçoit des { msg_type: 'data:update', tag, value: 'heure,vitesse,odometre,…' } dans l'ordre des colonnes
//   3. ou des { msg_type: 'data:error', error_type, value } (voiture endormie, jeton refusé…)
// Unités Tesla héritées des États-Unis : vitesse en mph, distances en miles ; puissance en kW ; batterie en %.

export const COLONNES = ['speed', 'odometer', 'soc', 'elevation', 'est_heading', 'est_lat', 'est_lng', 'power', 'shift_state', 'range', 'est_range', 'heading'];

const MILE_KM = 1.609344;
const nombre = (s) => (s === '' || s == null ? null : Number(s));

/** Message d'abonnement à envoyer à l'ouverture de la connexion. */
export function messageAbonnement(jeton, vin) {
  return JSON.stringify({ msg_type: 'data:subscribe_oauth', token: jeton, value: COLONNES.join(','), tag: vin });
}

/** Décode la chaîne « value » d'un message data:update. Renvoie null si le message est incohérent. */
export function decoderValeurs(value) {
  const champs = String(value).split(',');
  if (champs.length !== COLONNES.length + 1) return null; // heure + colonnes
  const v = Object.fromEntries(COLONNES.map((c, i) => [c, champs[i + 1]]));
  const vitesseMph = nombre(v.speed);
  return {
    t: nombre(champs[0]), // millisecondes
    vitesseKmh: vitesseMph == null ? null : vitesseMph * MILE_KM,
    odometreKm: nombre(v.odometer) == null ? null : nombre(v.odometer) * MILE_KM,
    batteriePct: nombre(v.soc),
    puissanceKw: nombre(v.power), // négative en récupération
    rapport: v.shift_state || null, // P, R, N, D (vide = voiture à l'arrêt complet)
    lat: nombre(v.est_lat),
    lon: nombre(v.est_lng),
    cap: nombre(v.heading),
  };
}

/** Interprète un message brut du WebSocket : { type: 'donnees' | 'erreur' | 'autre', … }. */
export function interpreterMessage(texte, vin) {
  let m;
  try {
    m = JSON.parse(texte);
  } catch {
    return { type: 'autre' };
  }
  if (m.msg_type === 'data:update' && m.tag === vin) {
    const donnees = decoderValeurs(m.value);
    return donnees ? { type: 'donnees', donnees } : { type: 'autre' };
  }
  if (m.msg_type === 'data:error') return { type: 'erreur', erreur: m.error_type, detail: m.value ?? null };
  return { type: 'autre', msgType: m.msg_type ?? null };
}

// ---------- Format brut (Fleet Telemetry) ----------
// Le format ci-dessus ne transporte que 12 colonnes fixes. Pour recevoir tous les champs configurés sur la voiture
// (CruiseSetSpeed, PackVoltage, RouteLine, MinutesToArrival…), on s'abonne en « data:subscribe_all » :
//   1. on envoie { msg_type: 'data:subscribe_all', token, tag: VIN } (jeton obligatoire) ;
//   2. on reçoit le message Tesla tel quel : { vin, createdAt, data: [{ key, value: { doubleValue: 12.5 } }, …] } ;
//   3. ou { msg_type: 'error', error_detail } ; et des « control:hello… » toutes les 10 s pour garder la connexion.
// Format déduit du code du serveur MyTeslaMate (github.com/MyTeslaMate/websocket), pas d'une documentation officielle.
// Chaque élément de « data » est un signal facturé : 150 signaux = 1 crédit MyTeslaMate.

export const SIGNAUX_PAR_CREDIT = 150;

/** Message d'abonnement au format brut. */
export function messageAbonnementBrut(jeton, vin) {
  return JSON.stringify({ msg_type: 'data:subscribe_all', token: jeton, tag: vin });
}

/**
 * Valeur lisible d'un signal Tesla. La valeur arrive « emballée » selon son type :
 * { doubleValue: 12.5 }, { intValue: 3 }, { stringValue: '…' }, { locationValue: { latitude, longitude } },
 * { shiftStateValue: 'ShiftStateD' }, { invalid: true } (pas de valeur, ex. aucune destination)…
 */
export function valeurSignal(valeur) {
  if (valeur == null || typeof valeur !== 'object') return valeur ?? null;
  if (valeur.invalid) return null;
  if (valeur.locationValue) return { lat: valeur.locationValue.latitude ?? null, lon: valeur.locationValue.longitude ?? null };
  const types = Object.keys(valeur);
  if (types.length !== 1) return null;
  const v = valeur[types[0]];
  if (types[0] === 'shiftStateValue' && typeof v === 'string') return v.replace(/^ShiftState/, '');
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v); // nombres envoyés en texte
  return v;
}

/** Interprète un message du format brut : { type: 'donnees' | 'erreur' | 'autre', … }. */
export function interpreterMessageBrut(texte, vin) {
  let m;
  try {
    m = JSON.parse(texte);
  } catch {
    return { type: 'autre' };
  }
  if (Array.isArray(m?.data)) {
    if (m.vin && m.vin !== vin) return { type: 'autre' };
    const champs = {};
    for (const s of m.data) if (s && s.key) champs[s.key] = valeurSignal(s.value);
    const t = typeof m.createdAt === 'number' ? m.createdAt : Date.parse(m.createdAt);
    return { type: 'donnees', t: Number.isNaN(t) ? null : t, champs, signaux: m.data.length };
  }
  if (m?.msg_type === 'error' || m?.msg_type === 'data:error') {
    return { type: 'erreur', erreur: m.error_detail ?? m.error_type ?? 'erreur inconnue', detail: m.value ?? null };
  }
  return { type: 'autre', msgType: m?.msg_type ?? null };
}

/** Texte court pour afficher une valeur dans le résultat du test (les longues chaînes, comme RouteLine, sont coupées). */
export function texteValeur(v, max = 40) {
  if (v == null) return '—';
  if (typeof v === 'object' && 'lat' in v) return `${v.lat}, ${v.lon}`;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return s.length > max ? `${s.slice(0, max)}… (${s.length} caractères)` : s;
}

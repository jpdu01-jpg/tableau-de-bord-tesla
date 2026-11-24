// Historique des trajets : un résumé par trajet, mis à jour pendant le trajet, et export CSV.
// Fonctions pures (pas d'accès au navigateur), testées dans tests/historique.test.js.
//
// Un trajet est identifié par son heure de départ (Trip.debut) : « Reprendre le trajet » met à jour la même ligne,
// « Démarrer » ou « Nouveau trajet » en crée une nouvelle.

export const DISTANCE_MIN_KM = 0.5; // en dessous, ce n'est pas un trajet (app ouverte à l'arrêt)
export const TAILLE_MAX = 1000; // trajets conservés au plus (les plus anciens sont oubliés)

/**
 * Résumé du trajet en cours, complété à partir du résumé précédent du même trajet (appelé toutes les 10 s).
 * La batterie au départ est la première valeur connue ; la destination, la dernière connue.
 * Météo (influence forte sur la consommation) : température et vent sont moyennés en les pondérant par les km
 * parcourus depuis le résumé précédent. ventFaceKmh : composante de face (positive = vent de face, négative = arrière).
 */
export function resumeTrajet(precedent, {
  debut, maintenant, distanceKm, energieKwh, batteriePct = null, destination = null,
  temperature = null, ventKmh = null, ventFaceKmh = null,
}) {
  const km = Math.max(0, distanceKm - (precedent?.distanceKm ?? 0)); // km parcourus depuis le résumé précédent
  const p = precedent ?? {};
  const avecTemp = temperature != null && km > 0;
  const avecVent = ventKmh != null && ventFaceKmh != null && km > 0;
  return {
    kmTemp: (p.kmTemp ?? 0) + (avecTemp ? km : 0), // sommes pondérées par les km (pour les moyennes)
    sommeTemp: (p.sommeTemp ?? 0) + (avecTemp ? temperature * km : 0),
    tempMin: temperature == null ? p.tempMin ?? null : Math.min(temperature, p.tempMin ?? Infinity),
    tempMax: temperature == null ? p.tempMax ?? null : Math.max(temperature, p.tempMax ?? -Infinity),
    kmVent: (p.kmVent ?? 0) + (avecVent ? km : 0),
    sommeVent: (p.sommeVent ?? 0) + (avecVent ? ventKmh * km : 0),
    sommeVentFace: (p.sommeVentFace ?? 0) + (avecVent ? ventFaceKmh * km : 0),
    debut,
    fin: maintenant,
    distanceKm,
    energieKwh,
    batterieDebutPct: precedent?.batterieDebutPct ?? batteriePct,
    batterieFinPct: batteriePct ?? precedent?.batterieFinPct ?? null,
    destination: destination ?? precedent?.destination ?? null,
  };
}

/** Ajoute ou remplace le résumé (même départ) dans la liste, la plus récente en tête. Renvoie une nouvelle liste. */
export function majHistorique(liste, resume) {
  if (resume.debut == null || !(resume.distanceKm >= DISTANCE_MIN_KM)) return liste;
  return [resume, ...liste.filter((r) => r.debut !== resume.debut)].sort((a, b) => b.debut - a.debut).slice(0, TAILLE_MAX);
}

/** Valeurs calculées d'un trajet, pour l'affichage et l'export. */
export function detailsTrajet(r) {
  const dureeMin = Math.max(0, (r.fin - r.debut) / 60000);
  return {
    dureeMin,
    kwh100: r.distanceKm >= 1 ? (r.energieKwh / r.distanceKm) * 100 : null,
    vitesseMoyKmh: dureeMin > 0 ? r.distanceKm / (dureeMin / 60) : null,
    batterieUtiliseePct: r.batterieDebutPct != null && r.batterieFinPct != null ? r.batterieDebutPct - r.batterieFinPct : null,
    temperatureMoy: r.kmTemp > 0 ? r.sommeTemp / r.kmTemp : null,
    ventMoyKmh: r.kmVent > 0 ? r.sommeVent / r.kmVent : null,
    ventFaceMoyKmh: r.kmVent > 0 ? r.sommeVentFace / r.kmVent : null,
  };
}

const deux = (n) => String(n).padStart(2, '0');
/** Date locale « 24/11/2026 ». */
export const texteDate = (ms) => { const d = new Date(ms); return `${deux(d.getDate())}/${deux(d.getMonth() + 1)}/${d.getFullYear()}`; };
/** Heure locale « 08:05 ». */
export const texteHeure = (ms) => { const d = new Date(ms); return `${deux(d.getHours())}:${deux(d.getMinutes())}`; };

// Nombres à la française (virgule) : Excel et Numbers en France les lisent directement.
const nombre = (v, decimales) =>
  v == null || !Number.isFinite(v) ? '' : (Math.abs(v) < 0.5 * 10 ** -decimales ? 0 : v).toFixed(decimales).replace('.', ','); // pas de « -0 »
// Point-virgule comme séparateur (la virgule sert aux décimales) ; texte entre guillemets s'il en contient.
const texte = (v) => (v == null ? '' : /[;"\r\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : String(v));

export const ENTETES_CSV = [
  'Date', 'Départ', 'Arrivée', 'Durée (min)', 'Distance (km)', 'Énergie (kWh)', 'Consommation (kWh/100 km)',
  'Vitesse moyenne (km/h)', 'Batterie départ (%)', 'Batterie arrivée (%)', 'Batterie utilisée (%)',
  'Température moyenne (°C)', 'Température min (°C)', 'Température max (°C)', 'Vent moyen (km/h)',
  'Vent de face moyen (km/h, négatif = arrière)', 'Destination',
];

/** Texte CSV de l'historique (du plus ancien au plus récent), séparateur « ; », fins de ligne Windows. */
export function historiqueCsv(liste) {
  const lignes = [...liste].sort((a, b) => a.debut - b.debut).map((r) => {
    const d = detailsTrajet(r);
    return [
      texteDate(r.debut), texteHeure(r.debut), texteHeure(r.fin), nombre(d.dureeMin, 0), nombre(r.distanceKm, 1),
      nombre(r.energieKwh, 2), nombre(d.kwh100, 1), nombre(d.vitesseMoyKmh, 0), nombre(r.batterieDebutPct, 0),
      nombre(r.batterieFinPct, 0), nombre(d.batterieUtiliseePct, 0), nombre(d.temperatureMoy, 1), nombre(r.tempMin, 1),
      nombre(r.tempMax, 1), nombre(d.ventMoyKmh, 0), nombre(d.ventFaceMoyKmh, 0), texte(r.destination),
    ].join(';');
  });
  return [ENTETES_CSV.join(';'), ...lignes].join('\r\n') + '\r\n';
}

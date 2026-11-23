// Calculs géographiques de base. Fonctions pures, testées dans tests/geo.test.js.

const R_TERRE = 6371008.8; // rayon moyen de la Terre, en mètres
const rad = (deg) => (deg * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

/** Distance en mètres entre deux points {lat, lon} (formule de haversine). */
export function distanceM(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_TERRE * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Cap en degrés (0 = nord, 90 = est) pour aller de a vers b. */
export function bearingDeg(a, b) {
  const φ1 = rad(a.lat);
  const φ2 = rad(b.lat);
  const dλ = rad(b.lon - a.lon);
  const y = Math.sin(dλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(dλ);
  return normalize360(deg(Math.atan2(y, x)));
}

/** Point situé à `distance` mètres de `depart`, dans la direction `cap` (degrés). */
export function destination(depart, cap, distance) {
  const δ = distance / R_TERRE;
  const θ = rad(cap);
  const φ1 = rad(depart.lat);
  const λ1 = rad(depart.lon);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: deg(φ2), lon: deg(λ2) };
}

/** Ramène un angle dans [0, 360[. */
export function normalize360(a) {
  return ((a % 360) + 360) % 360;
}

/** Écart signé de a vers b, dans ]-180, 180]. */
export function angleDiff(a, b) {
  const d = normalize360(b - a);
  return d > 180 ? d - 360 : d;
}

/**
 * Distance en mètres entre un point p et le segment [a, b], et cap du segment (a → b).
 * Utilise une projection plane locale : précise à quelques centimètres sur les petites distances.
 */
export function pointToSegment(p, a, b) {
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

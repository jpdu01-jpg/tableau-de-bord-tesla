// GPS du téléphone : position, vitesse et cap, via l'API de géolocalisation du navigateur.
import { distanceM, bearingDeg } from '../lib/geo.js';

/**
 * Démarre le suivi GPS. Appelle onFix({lat, lon, accuracy, speed (m/s), heading (°) | null, t}).
 * Retourne une fonction pour arrêter le suivi.
 */
export function startGps(onFix, onError) {
  if (!('geolocation' in navigator)) {
    onError(new Error('GPS non disponible sur cet appareil'));
    return () => {};
  }
  let prec = null;
  let dernierCap = null;

  const id = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      const p = { lat: c.latitude, lon: c.longitude, accuracy: c.accuracy, t: pos.timestamp };

      // Certains appareils ne fournissent pas vitesse/cap : on les calcule depuis la position précédente.
      let speed = c.speed;
      let heading = Number.isFinite(c.heading) ? c.heading : null;
      if (prec) {
        const d = distanceM(prec, p);
        const dt = (p.t - prec.t) / 1000;
        if ((speed == null || speed < 0) && dt > 0) speed = d / dt;
        if (heading == null && d > 5) heading = bearingDeg(prec, p);
      }
      // À l'arrêt, le cap n'a plus de sens : on garde le dernier connu.
      if (heading != null && (speed ?? 0) > 1.5) dernierCap = heading;

      p.speed = Math.max(0, speed ?? 0);
      p.heading = dernierCap;
      prec = p;
      onFix(p);
    },
    (err) => onError(new Error(err.code === 1 ? 'Accès au GPS refusé' : 'Signal GPS indisponible')),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
  );
  return () => navigator.geolocation.clearWatch(id);
}

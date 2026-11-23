// Affichage de la carte de navigation (Mapbox GL JS). Affichage uniquement : les calculs sont dans src/lib/navigation.js.
//
// La bibliothèque Mapbox GL est chargée depuis le site de Mapbox (pas d'npm dans ce projet), seulement à la première
// ouverture de la carte. Elle utilise la même clé que les limitations de vitesse.
// Coût : chaque ouverture de l'application compte un « chargement de carte » ; 50 000 gratuits par mois.
import { zoomPourVitesse } from './lib/navigation.js';

const VERSION = '3.9.0';
const STYLE = 'mapbox://styles/mapbox/navigation-night-v1'; // style sombre conçu pour la conduite
const BLEU_TESLA = '#3e82ff';

let carte = null;
let marqueur = null;
let marqueurPose = false;
let chargement = null;
let traceAffichee = null;
let destinationAffichee = null;
let marqueurDestination = null;

function chargerBibliotheque() {
  if (window.mapboxgl) return Promise.resolve();
  chargement ??= new Promise((ok, echec) => {
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `https://api.mapbox.com/mapbox-gl-js/v${VERSION}/mapbox-gl.css`;
    document.head.append(css);
    const js = document.createElement('script');
    js.src = `https://api.mapbox.com/mapbox-gl-js/v${VERSION}/mapbox-gl.js`;
    js.onload = ok;
    js.onerror = () => {
      chargement = null; // nouvel essai à la prochaine ouverture
      echec(new Error('Carte indisponible (pas de réseau ?)'));
    };
    document.head.append(js);
  });
  return chargement;
}

/** Crée la carte (une seule fois). `message` : élément où écrire un problème éventuel. */
export async function ouvrirCarte(conteneur, jeton, message, position) {
  if (carte) {
    carte.resize();
    return;
  }
  if (!jeton) {
    message.textContent = 'Carte : enregistre une clé Mapbox dans les Réglages.';
    return;
  }
  try {
    await chargerBibliotheque();
  } catch (e) {
    message.textContent = e.message;
    return;
  }
  if (carte) return; // ouverte entre-temps
  message.textContent = '';
  window.mapboxgl.accessToken = jeton;
  carte = new window.mapboxgl.Map({
    container: conteneur,
    style: STYLE,
    center: position ? [position.lon, position.lat] : [2.35, 48.85],
    zoom: 15,
    pitch: 50, // vue inclinée, comme l'écran de la Tesla
    interactive: false, // la carte suit la voiture ; toucher l'écran sert à changer d'affichage
    attributionControl: false,
  });
  carte.addControl(new window.mapboxgl.AttributionControl({ compact: true }));
  carte.on('error', (ev) => {
    if (ev.error?.status === 401) message.textContent = 'Carte : clé Mapbox refusée.';
  });
  carte.on('load', () => {
    carte.addSource('itineraire', { type: 'geojson', data: ligne([]) });
    carte.addLayer({ id: 'itineraire-bord', type: 'line', source: 'itineraire',
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#0b2a66', 'line-width': 11 } });
    carte.addLayer({ id: 'itineraire', type: 'line', source: 'itineraire',
      layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': BLEU_TESLA, 'line-width': 7 } });
    traceAffichee = null; // force le dessin du tracé déjà reçu
  });

  const el = document.createElement('div');
  el.className = 'marqueur-voiture';
  el.innerHTML = '<svg viewBox="0 0 40 40"><circle cx="20" cy="20" r="18"/><path d="M20 8 L29 30 L20 25 L11 30 Z"/></svg>';
  marqueur = new window.mapboxgl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
}

const ligne = (points) => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: points.map((p) => [p.lon, p.lat]) },
});

/** Met à jour la carte : { position, cap, vitesseKmh, trace, destinationPos }. */
export function majCarte(c) {
  if (!carte) return;
  if (c.position) {
    marqueur.setLngLat([c.position.lon, c.position.lat]).setRotation(c.cap ?? 0);
    if (!marqueurPose) {
      marqueur.addTo(carte);
      marqueurPose = true;
    }
    carte.easeTo({
      center: [c.position.lon, c.position.lat],
      bearing: c.cap ?? carte.getBearing(), // sens de la marche vers le haut
      zoom: zoomPourVitesse(c.vitesseKmh),
      pitch: 50,
      padding: { top: carte.getContainer().clientHeight * 0.35, bottom: 0, left: 0, right: 0 }, // voiture en bas : on voit loin devant
      duration: 900,
      easing: (t) => t,
    });
  }
  const source = carte.getSource?.('itineraire');
  if (source && c.trace !== traceAffichee) {
    source.setData(ligne(c.trace || []));
    traceAffichee = c.trace;
  }
  if (c.destinationPos !== destinationAffichee) {
    marqueurDestination?.remove();
    marqueurDestination = c.destinationPos
      ? new window.mapboxgl.Marker({ color: BLEU_TESLA }).setLngLat([c.destinationPos.lon, c.destinationPos.lat]).addTo(carte)
      : null;
    destinationAffichee = c.destinationPos;
  }
}

/** À appeler quand la taille de la zone change (passage en mode navigation, rotation du téléphone). */
export const redimensionnerCarte = () => carte?.resize();

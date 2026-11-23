// Point d'entrée : relie les sources de données, les calculs et l'affichage.
import { Trip, instantKwhPer100 } from './lib/trip.js';
import { relativeWind } from './lib/wind.js';
import { startGps } from './sources/gps.js';
import { SpeedLimitService } from './sources/speedLimit.js';
import { MapboxLimitService, lireJeton, enregistrerJeton, lireCompteur } from './sources/mapboxLimit.js';
import { WeatherService } from './sources/weather.js';
import { TeslaNonConnectee } from './sources/tesla.js';
import { Simulation } from './sources/simulation.js';
import { construire, afficher } from './ui.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

let mode = null; // 'reel' | 'demo'
let trip = null;
let arreter = () => {};
let verrouEcran = null;
const limites = new SpeedLimitService(); // OpenStreetMap : secours
let mapbox = new MapboxLimitService(); // Mapbox : source principale si une clé est enregistrée
const meteo = new WeatherService();
let tesla = new TeslaNonConnectee();

// Dernières valeurs reçues
const etat = {
  fix: null, // dernière position GPS
  limite: null,
  sourceLimite: null, // 'Mapbox' | 'OSM'
  meteo: null,
  powerKw: null,
  cruiseKmh: null,
  batteryPct: null, // niveau de batterie (%), envoyé par la Tesla au plus une fois par minute
  batteryT: 0,
  derniereTesla: 0,
  recuLe: 0, // heure de réception (horloge du téléphone) de la dernière position
};

const cleTrajet = () => (mode === 'demo' ? 'trajet-demo' : 'trajet');

// ---------- Réception des données ----------
function surPosition(p) {
  etat.fix = p;
  etat.recuLe = Date.now();
  trip.addPosition(p);
  choisirLimite(p);
  etat.meteo = meteo.update(p);
  if (simulation) simulation.ventDeFaceMs = ventRelatif()?.face / 3.6 || 0; // la vraie météo influence la conso simulée
  planifierAffichage();
}

// Mapbox si disponible ; OpenStreetMap si pas de clé, quota atteint, clé refusée ou Mapbox injoignable.
function choisirLimite(p) {
  if (mapbox.disponible) {
    const r = mapbox.update(p);
    if (r || mapbox.etat !== 'erreur') {
      etat.limite = r;
      etat.sourceLimite = 'Mapbox';
      return;
    }
  }
  etat.limite = limites.update(p, p.heading);
  etat.sourceLimite = 'OSM';
}

function surTesla(d) {
  if (d.powerKw != null) {
    etat.powerKw = d.powerKw;
    trip.addPower(d.powerKw, d.t);
  }
  if ('cruiseKmh' in d) etat.cruiseKmh = d.cruiseKmh;
  if (d.batteryPct != null) {
    etat.batteryPct = d.batteryPct;
    etat.batteryT = d.t;
  }
  etat.derniereTesla = d.t;
  planifierAffichage();
}

// ---------- Affichage (au plus une fois par image) ----------
let affichagePrevu = false;
function planifierAffichage() {
  if (affichagePrevu) return;
  affichagePrevu = true;
  requestAnimationFrame(() => {
    affichagePrevu = false;
    afficher(calculerEcran());
  });
}

function calculerEcran() {
  const p = etat.fix;
  const speedKmh = p ? Math.round(p.speed * 3.6) : 0;
  const m = etat.meteo;
  const vent = ventRelatif();

  const maintenant = p?.t ?? Date.now();
  const teslaRecente = maintenant - etat.derniereTesla < 30000;
  return {
    speedKmh,
    limitKmh: etat.limite?.limit ?? null,
    roadRef: etat.limite?.ref,
    roadName: etat.limite?.name,
    cruiseKmh: teslaRecente ? etat.cruiseKmh : null,
    powerKw: teslaRecente ? etat.powerKw : null,
    instantKwh100: teslaRecente ? instantKwhPer100(etat.powerKw, speedKmh) : null,
    batteryPct: maintenant - etat.batteryT < 10 * 60000 ? etat.batteryPct : null, // masqué si plus vieux que 10 min
    moyenneKwh100: trip.moyenneKwhPer100,
    distanceKm: trip.distanceKm,
    energieKwh: trip.energieKwh,
    dureeS: trip.dureeS(maintenant),
    vent,
    temperature: m?.temperature ?? null,
    sourceLimite: etat.sourceLimite,
    statuts: {
      'st-gps': Date.now() - etat.recuLe < 10000 ? 'ok' : 'attente',
      'st-osm': etat.sourceLimite === 'Mapbox' ? (mapbox.etat === 'refuse' ? 'erreur' : mapbox.etat) : limites.etat,
      'st-meteo': meteo.etat,
      'st-tesla': tesla.etat === 'simulation' ? 'simulation' : teslaRecente ? 'ok' : 'erreur',
    },
  };
}

function ventRelatif() {
  const m = etat.meteo, p = etat.fix;
  if (!m || p?.heading == null) return null;
  return { ...relativeWind(m.ventVientDe, m.vitesseVent, p.heading), vitesse: m.vitesseVent };
}

// ---------- Démarrage / arrêt ----------
let simulation = null;

async function demarrer(nouveauMode, reprendre) {
  mode = nouveauMode;
  const sauvegarde = reprendre ? JSON.parse(localStorage.getItem(cleTrajet()) || 'null') : null;
  trip = new Trip(sauvegarde);
  $('accueil').hidden = true;
  await garderEcranAllume();

  if (mode === 'demo') {
    const sim = new Simulation(Number(params.get('vitesse')) || 1);
    simulation = sim;
    tesla = sim;
    sim.start(surPosition, surTesla);
    arreter = () => sim.stop();
  } else {
    simulation = null;
    tesla = new TeslaNonConnectee();
    const stopGps = startGps(surPosition, (err) => {
      $('message').textContent = err.message;
    });
    arreter = () => stopGps();
  }
  planifierAffichage();
}

function quitter() {
  arreter();
  sauvegarder();
  verrouEcran?.release();
  $('accueil').hidden = false;
  preparerAccueil();
}

function sauvegarder() {
  if (trip) localStorage.setItem(cleTrajet(), JSON.stringify(trip));
}

// Empêche l'écran du téléphone de se mettre en veille pendant le trajet.
async function garderEcranAllume() {
  try {
    verrouEcran = await navigator.wakeLock?.request('screen');
  } catch {
    /* non supporté : l'utilisateur devra régler la mise en veille automatique */
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && mode && $('accueil').hidden) garderEcranAllume();
});

function preparerAccueil() {
  $('btn-reprendre').hidden = !localStorage.getItem('trajet');
  const compteur = lireCompteur();
  const ceMois = compteur?.mois === new Date().toISOString().slice(0, 7) ? compteur.n : 0;
  $('info-mapbox').textContent = lireJeton()
    ? `Clé enregistrée · ${ceMois.toLocaleString('fr-FR')} requêtes ce mois-ci (gratuit jusqu'à 100 000)`
    : 'Aucune clé : les limitations viennent d\'OpenStreetMap (moins fiable).';
}

// ---------- Boutons ----------
$('btn-demarrer').onclick = () => demarrer('reel', false);
$('btn-reprendre').onclick = () => demarrer('reel', true);
$('btn-demo').onclick = () => demarrer('demo', false);
$('btn-quitter').onclick = quitter;
$('btn-jeton').onclick = () => {
  enregistrerJeton($('jeton-mapbox').value);
  $('jeton-mapbox').value = '';
  mapbox = new MapboxLimitService(); // repart de zéro avec la nouvelle clé
  preparerAccueil();
};
$('btn-nouveau').onclick = () => {
  if (!confirm('Remettre le trajet à zéro ?')) return;
  trip = new Trip();
  sauvegarder();
  planifierAffichage();
};

setInterval(sauvegarder, 10000); // le trajet survit à un rechargement ou une fermeture de l'app
setInterval(planifierAffichage, 1000); // horloge et durée, même sans nouvelle position

construire();
preparerAccueil();
if (params.has('demo')) demarrer('demo', false);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');

// Point d'entrée : relie les sources de données, les calculs et l'affichage.
import { Trip, instantKwhPer100 } from './lib/trip.js';
import { relativeWind } from './lib/wind.js';
import { startGps } from './sources/gps.js';
import { SpeedLimitService } from './sources/speedLimit.js';
import { MapboxLimitService, lireJeton, enregistrerJeton, lireCompteur } from './sources/mapboxLimit.js';
import { lireJetonMTM, enregistrerJetonMTM, listerVehicules, testerFlux, lireConfigTelemetrie, TeslaMyTeslaMate, FLUX_PARTAGE_DISPONIBLE } from './sources/myteslamate.js';
import { navigationActive, basculeAuto, heureArrivee } from './lib/navigation.js';
import { SIGNAUX_PAR_CREDIT, texteValeur, resumerConfigTelemetrie } from './lib/teslaStream.js';
import { WeatherService } from './sources/weather.js';
import { TeslaNonConnectee } from './sources/tesla.js';
import { Teslogic, bluetoothDisponible } from './sources/teslogic.js';
import { lireJetonTeslemetry, enregistrerJetonTeslemetry, lireRelaisTeslemetry, enregistrerRelaisTeslemetry, vehiculesTeslemetry, configTeslemetry, testerFluxTeslemetry, TeslaTeslemetry } from './sources/teslemetry.js';
import { resumerConfigTeslemetry } from './lib/teslemetry.js';
import { Simulation } from './sources/simulation.js';
import { construire, afficher, afficherModeNavigation } from './ui.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
// Flux Tesla : coupé par défaut (voir myteslamate.js). « ?flux=1 » l'active pour un essai, À CONDITION d'avoir
// désactivé le streaming dans TeslaMate, sinon les deux se volent le flux.
const FLUX_TESLA = FLUX_PARTAGE_DISPONIBLE || params.get('flux') === '1';

let mode = null; // 'reel' | 'demo'
let trip = null;
let arreter = () => {};
let verrouEcran = null;
const limites = new SpeedLimitService(); // OpenStreetMap : secours
let mapbox = new MapboxLimitService(); // Mapbox : source principale si une clé est enregistrée
const meteo = new WeatherService();
let tesla = new TeslaNonConnectee();
const teslogic = new Teslogic(); // boîtier branché sur la voiture (Bluetooth) : prioritaire quand il émet

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
  nav: {}, // navigation de la Tesla : destinationNom, destinationPos, trace, minutesArrivee, kmArrivee, retardTraficMin, batterieArriveePct
  navRecueLe: 0, // heure de réception des minutes restantes (pour l'heure d'arrivée)
  can: {}, // dernières valeurs du boîtier Teslogic : powerKw, speedKmh, batteryPct, cruiseKmh, limitKmh
  canT: 0,
};

// Le boîtier Teslogic émet plusieurs fois par seconde : au-delà de 3 s sans rien, on revient aux autres sources.
const canRecente = () => mode === 'reel' && Date.now() - etat.canT < 3000;
let modeNavigation = false;

const CHAMPS_NAV = ['destinationNom', 'destinationPos', 'trace', 'minutesArrivee', 'kmArrivee', 'retardTraficMin', 'batterieArriveePct'];

const cleTrajet = () => (mode === 'demo' ? 'trajet-demo' : 'trajet');

// ---------- Réception des données ----------
function surPosition(p) {
  etat.fix = p;
  etat.recuLe = Date.now();
  trip.addPosition(p);
  choisirLimite(p);
  etat.meteo = meteo.update(p);
  if ('vitesseGpsKmh' in tesla) tesla.vitesseGpsKmh = p.speed * 3.6; // sert à deviner l'unité du régulateur
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

function surTeslogic(d) {
  Object.assign(etat.can, d);
  etat.canT = d.t;
  if (d.powerKw != null) trip.addPower(d.powerKw, d.t);
  planifierAffichage();
}

function connecterTeslogic() {
  teslogic.connecter(surTeslogic).catch((e) => {
    if (e.name !== 'NotFoundError') alert(`Boîtier Teslogic : ${e.message}`); // NotFoundError = fenêtre fermée
  });
}

function surTesla(d) {
  if (d.powerKw != null) {
    etat.powerKw = d.powerKw;
    if (!canRecente()) trip.addPower(d.powerKw, d.t); // le boîtier, bien plus précis, s'en charge
  }
  if ('cruiseKmh' in d) etat.cruiseKmh = d.cruiseKmh;
  if ('autopilotActif' in d) etat.autopilotActif = d.autopilotActif; // mode démo seulement (en réel : boîtier Teslogic)
  if (d.batteryPct != null) {
    etat.batteryPct = d.batteryPct;
    etat.batteryT = d.t;
  }
  const avaitDestination = navigationActive(etat.nav);
  for (const c of CHAMPS_NAV) if (c in d) etat.nav[c] = d[c];
  if ('minutesArrivee' in d) etat.navRecueLe = d.t;
  const bascule = basculeAuto(avaitDestination, navigationActive(etat.nav));
  if (bascule) changerModeNavigation(bascule === 'ouvrir');
  etat.derniereTesla = d.t;
  planifierAffichage();
}

// Écran partagé carte + compteurs. Toucher l'écran bascule ; une destination saisie dans la Tesla l'ouvre.
function changerModeNavigation(ouvert) {
  modeNavigation = ouvert;
  afficherModeNavigation(ouvert, lireJeton(), etat.fix);
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
  const can = canRecente() ? etat.can : {};
  // vitesse affichée par la voiture si le boîtier émet, sinon celle du GPS
  const speedKmh = can.speedKmh ?? (p ? Math.round(p.speed * 3.6) : 0);
  const m = etat.meteo;
  const vent = ventRelatif();

  const maintenant = p?.t ?? Date.now();
  // Les données Tesla sont datées avec l'horloge du téléphone (sauf en démo, horloge simulée). On ne peut pas
  // utiliser l'heure du dernier point GPS : à l'arrêt, il n'y en a plus, et une donnée ancienne paraissait récente.
  const horlogeTesla = tesla.etat === 'simulation' ? maintenant : Date.now();
  const teslaRecente = horlogeTesla - etat.derniereTesla < 30000;
  const limiteVoiture = can.limitKmh != null;
  const powerKw = can.powerKw ?? (teslaRecente ? etat.powerKw : null);
  return {
    speedKmh,
    limitKmh: limiteVoiture ? can.limitKmh : etat.limite?.limit ?? null,
    // Mapbox (ou OSM) reste interrogé pour le nom de la rue, même quand la limitation vient de la voiture
    roadRef: etat.limite?.ref,
    roadName: etat.limite?.name,
    cruiseKmh: 'cruiseKmh' in can ? can.cruiseKmh : teslaRecente ? etat.cruiseKmh : null,
    autopilotActif: can.autopilotActif ?? (teslaRecente && etat.autopilotActif === true),
    powerKw,
    instantKwh100: instantKwhPer100(powerKw, speedKmh),
    batteryPct: can.batteryPct ?? (horlogeTesla - etat.batteryT < 10 * 60000 ? etat.batteryPct : null), // masqué si plus vieux que 10 min
    moyenneKwh100: trip.moyenneKwhPer100,
    distanceKm: trip.distanceKm,
    energieKwh: trip.energieKwh,
    dureeS: trip.dureeS(maintenant),
    vent,
    temperature: m?.temperature ?? null,
    sourceLimite: limiteVoiture ? 'Voiture' : etat.sourceLimite,
    diagTesla: diagnosticVisible ? { etat: tesla.etat, ...tesla.diag } : null,
    diagTeslogic: diagnosticVisible && mode === 'reel' ? { etat: teslogic.etat, ...teslogic.diag } : null,
    navigation: {
      ...etat.nav,
      active: navigationActive(etat.nav),
      // les minutes restantes arrivent au plus une fois par minute : on décompte le temps écoulé depuis
      minutesArrivee: etat.nav.minutesArrivee == null ? null : Math.max(0, etat.nav.minutesArrivee - (maintenant - etat.navRecueLe) / 60000),
      heureArrivee: heureArrivee(etat.navRecueLe, etat.nav.minutesArrivee),
    },
    carte: { position: p, cap: p?.heading, vitesseKmh: speedKmh, trace: etat.nav.trace, destinationPos: etat.nav.destinationPos },
    statuts: {
      'st-gps': Date.now() - etat.recuLe < 10000 ? 'ok' : 'attente',
      'st-osm': etat.sourceLimite === 'Mapbox' ? (mapbox.etat === 'refuse' ? 'erreur' : mapbox.etat) : limites.etat,
      'st-meteo': meteo.etat,
      'st-tesla': tesla.etat === 'simulation' ? 'simulation' : teslaRecente ? 'ok' : 'erreur',
      'st-can': mode === 'demo' ? 'simulation' : canRecente() ? 'ok' : teslogic.etat === 'connexion' ? 'attente' : teslogic.etat === 'deconnecte' ? '' : 'erreur',
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
  etat.nav = {};
  changerModeNavigation(false);
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
    // Teslemetry en priorité (pas de conflit avec TeslaMate) ; sinon MyTeslaMate en mode essai (voir myteslamate.js)
    tesla = lireJetonTeslemetry() ? new TeslaTeslemetry()
      : lireJetonMTM() && FLUX_TESLA ? new TeslaMyTeslaMate() : new TeslaNonConnectee();
    tesla.start(surTesla);
    const stopGps = startGps(surPosition, (err) => {
      $('message').textContent = err.message;
    });
    arreter = () => {
      stopGps();
      tesla.stop();
      teslogic.stop();
    };
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
  $('info-mtm').textContent = !lireJetonMTM() ? 'Aucune clé : données Tesla indisponibles hors démo.'
    : FLUX_TESLA ? 'Clé enregistrée.' + (FLUX_PARTAGE_DISPONIBLE ? '' : ' Mode essai du flux (?flux=1) : streaming TeslaMate désactivé ?')
    : 'Clé enregistrée. Données en conduite en pause : le flux MyTeslaMate est déjà utilisé par TeslaMate.';
  $('btn-test-tesla').disabled = !lireJetonMTM();
  $('info-teslemetry').textContent = lireJetonTeslemetry()
    ? `Jeton enregistré : données de la voiture via Teslemetry (prioritaire sur MyTeslaMate). ${lireRelaisTeslemetry() ? 'Relais enregistré.' : 'Relais à enregistrer (voir relais/LISEZMOI.md).'}`
    : 'Aucun jeton. À créer dans la console Teslemetry (Applications and API → Access Tokens).';
  $('relais-teslemetry').value = lireRelaisTeslemetry(); // pas un secret : affiché pour vérification
  $('btn-test-teslemetry').disabled = !lireJetonTeslemetry();
}

// Test Teslemetry : véhicules, configuration de streaming, puis 15 s d'écoute du flux (tout est gratuit).
async function testerTeslemetry() {
  const sortie = $('resultat-test');
  const ecrire = (ligne) => { sortie.hidden = false; sortie.textContent += ligne + '\n'; };
  sortie.textContent = '';
  $('btn-test-teslemetry').disabled = true;
  try {
    ecrire('Liste des véhicules…');
    const vehicules = await vehiculesTeslemetry();
    if (!vehicules.length) return ecrire('Aucun véhicule sur ce compte Teslemetry.');
    vehicules.forEach((v) => ecrire(`• ${v.nom} — VIN …${v.vin.slice(-4)} — abonnement ${v.plan ?? 'aucun'}`));
    const v = vehicules[0];
    try {
      const c = resumerConfigTeslemetry(await configTeslemetry(v.vin));
      if (!c) ecrire('\nStreaming : aucun champ configuré dans la console Teslemetry.');
      else {
        ecrire(`\nStreaming : ${c.nbChamps} champs configurés${c.allocationPct != null ? ` (${Math.round(c.allocationPct)} % de l'allocation)` : ''}`);
        ecrire(c.manquants.length ? `Champs à ajouter dans la console : ${c.manquants.join(', ')}` : 'Tous les champs du tableau de bord sont configurés ✓');
      }
    } catch (e) {
      ecrire(`\nConfiguration de streaming illisible : ${e.message}`);
    }
    ecrire('\nÉcoute du flux pendant 15 secondes…');
    const r = await testerFluxTeslemetry(v.vin);
    if (!r.ouvert) {
      ecrire('Flux impossible à ouvrir depuis ce navigateur.');
      return ecrire(lireRelaisTeslemetry() ? 'Vérifie l\'adresse du relais et que le Worker est bien déployé.' : 'Enregistre l\'adresse du relais Cloudflare (Teslemetry bloque les pages web).');
    }
    ecrire(`Flux ouvert ✓ · ${r.mises} mise(s) à jour${r.etat ? ` · voiture ${r.etat}` : ''}`);
    const noms = Object.keys(r.champs).sort();
    noms.forEach((n) => ecrire(`  ${n} = ${texteValeur(r.champs[n])}`));
    if (!noms.length) ecrire('Aucune valeur reçue : normal si la voiture dort ou ne roule pas.');
  } catch (e) {
    ecrire(`Échec : ${e.message}`);
  } finally {
    $('btn-test-teslemetry').disabled = !lireJetonTeslemetry();
  }
}

// Test de connexion Tesla : liste des véhicules, puis 20 s de flux temps réel si la voiture est éveillée.
async function testerTesla() {
  const sortie = $('resultat-test');
  const ecrire = (ligne) => { sortie.hidden = false; sortie.textContent += ligne + '\n'; };
  sortie.textContent = '';
  $('btn-test-tesla').disabled = true;
  try {
    ecrire('Liste des véhicules…');
    const vehicules = await listerVehicules();
    if (!vehicules.length) return ecrire('Aucun véhicule sur ce compte.');
    vehicules.forEach((v) => ecrire(`• ${v.nom} — VIN ${v.vin} — ${v.etat === 'online' ? 'éveillée' : v.etat === 'asleep' ? 'endormie' : v.etat}`));
    const v = vehicules[0];
    try {
      const c = resumerConfigTelemetrie(await lireConfigTelemetrie(v.vin));
      if (!c) ecrire('\nConfiguration télémétrie : aucune sur la voiture.');
      else {
        ecrire(`\nConfiguration télémétrie : ${c.synchronisee ? 'appliquée à la voiture ✓' : 'PAS ENCORE appliquée (voiture à éveiller)'} · ${c.nbChamps} champs`);
        if (c.expire) ecrire(`Expire le ${c.expire.toLocaleDateString('fr-FR')}`);
        ecrire(c.manquants.length ? `Champs manquants pour le tableau de bord : ${c.manquants.join(', ')}` : 'Tous les champs du tableau de bord sont configurés ✓');
      }
    } catch (e) {
      ecrire(`\nConfiguration télémétrie illisible : ${e.message}`);
    }
    if (!FLUX_TESLA) {
      return ecrire('\nFlux temps réel non testé : le serveur MyTeslaMate ne l\'envoie qu\'à un seul abonné,\net ton TeslaMate l\'utilise déjà. En attente d\'une évolution chez MyTeslaMate.');
    }
    if (v.etat !== 'online') {
      return ecrire('\nLa voiture dort : flux non testé (la réveiller coûte 20 crédits).\nRelance le test voiture éveillée, par exemple après l\'avoir ouverte avec l\'app Tesla.');
    }
    ecrire('\nÉcoute du flux temps réel pendant 20 secondes…');
    const r = await testerFlux(v.vin);
    ecrire(`Messages reçus : ${r.messages}, dont ${r.mises} mises à jour de données`);
    ecrire(`Signaux facturés : ${r.signaux} (≈ ${(r.signaux / SIGNAUX_PAR_CREDIT).toFixed(2)} crédit)`);
    if (r.autres.length) ecrire(`Autres messages : ${r.autres.join(', ')}`);
    if (r.erreurs.length) ecrire(`Erreurs : ${r.erreurs.join(' ; ')}`);
    const noms = Object.keys(r.champs).sort();
    if (noms.length) {
      ecrire(`\nChamps reçus (${noms.length}) :`);
      noms.forEach((n) => ecrire(`  ${n} = ${texteValeur(r.champs[n])}`));
    } else if (!r.erreurs.length) {
      ecrire('Aucun champ reçu : la voiture n\'envoie une valeur que lorsqu\'elle change (essaie en roulant).');
    }
    ecrire(`Connexion : ${r.ferme}`);
    ecrire('\nVérifie maintenant le coût de ce test dans le journal MyTeslaMate.');
  } catch (e) {
    ecrire(`Échec : ${e.message}`);
  } finally {
    $('btn-test-tesla').disabled = !lireJetonMTM();
  }
}

// ---------- Boutons ----------
// En réel, le toucher sur « Démarrer » sert aussi à choisir le boîtier Teslogic (le navigateur l'exige).
const demarrerReel = (reprendre) => {
  if (bluetoothDisponible() && teslogic.etat !== 'ok') connecterTeslogic();
  demarrer('reel', reprendre);
};
$('btn-demarrer').onclick = () => demarrerReel(false);
$('btn-reprendre').onclick = () => demarrerReel(true);
$('btn-demo').onclick = () => demarrer('demo', false);
$('btn-quitter').onclick = quitter;
// Toucher la pastille « Tesla » affiche ce qui se passe sur le flux (pour comprendre une absence de données).
let diagnosticVisible = false;
$('st-tesla').addEventListener('click', (ev) => {
  ev.stopPropagation(); // ne pas basculer la carte
  diagnosticVisible = !diagnosticVisible;
  planifierAffichage();
});
// Pastille « Voiture » (boîtier Teslogic) : connecte le boîtier s'il ne l'est pas, sinon affiche le diagnostic.
$('st-can').addEventListener('click', (ev) => {
  ev.stopPropagation();
  if (mode !== 'reel') return;
  if (!bluetoothDisponible()) return alert('Bluetooth indisponible dans ce navigateur : ouvre l\'app dans Bluefy.');
  if (teslogic.etat === 'ok') diagnosticVisible = !diagnosticVisible;
  else connecterTeslogic();
  planifierAffichage();
});
$('cockpit').addEventListener('click', (ev) => {
  if (!ev.target.closest('button, a')) changerModeNavigation(!modeNavigation);
});
$('btn-jeton-mtm').onclick = () => {
  enregistrerJetonMTM($('jeton-mtm').value);
  $('jeton-mtm').value = '';
  preparerAccueil();
};
$('btn-test-tesla').onclick = testerTesla;
$('btn-test-teslemetry').onclick = testerTeslemetry;
$('btn-relais-teslemetry').onclick = () => {
  enregistrerRelaisTeslemetry($('relais-teslemetry').value);
  preparerAccueil();
};
$('btn-jeton-teslemetry').onclick = () => {
  enregistrerJetonTeslemetry($('jeton-teslemetry').value);
  $('jeton-teslemetry').value = '';
  preparerAccueil();
};
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

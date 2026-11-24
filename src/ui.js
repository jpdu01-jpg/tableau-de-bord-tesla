// Affichage du tableau de bord. Aucun calcul métier ici : on reçoit un état et on l'affiche.
import { ouvrirCarte, majCarte, redimensionnerCarte } from './carte.js';
import { texteConsoInstantanee, textePuissance } from './lib/format.js';

const VITESSE_MAX = 200; // km/h, fin de l'échelle du compteur
const PUISSANCE_MIN = -60; // kW, récupération maximale affichée
const PUISSANCE_MAX = 150; // kW
const CONSO_BARRE_MAX = 40; // kWh/100 km, pleine échelle de la barre de consommation

const $ = (id) => document.getElementById(id);
const nombre = (v, decimales = 0) =>
  v == null || !Number.isFinite(v) ? '--' : v.toLocaleString('fr-FR', { minimumFractionDigits: decimales, maximumFractionDigits: decimales });

// ---------- Géométrie des arcs ----------
function point(cx, cy, r, angleDeg) {
  const a = ((angleDeg - 90) * Math.PI) / 180; // 0° = en haut, sens horaire
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx, cy, r, debut, fin) {
  const [x1, y1] = point(cx, cy, r, debut);
  const [x2, y2] = point(cx, cy, r, fin);
  const grand = fin - debut > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${grand} 1 ${x2} ${y2}`;
}

// Compteur : arc de 270° (de -135° à +135°) centré en (150, 150).
const C = { cx: 150, cy: 150, r: 128, debut: -135, fin: 135 };
const angleVitesse = (kmh) => C.debut + (Math.min(Math.max(kmh, 0), VITESSE_MAX) / VITESSE_MAX) * (C.fin - C.debut);

// Jauge de puissance : arc de 180° centré en (100, 100).
const P = { cx: 100, cy: 100, r: 78, debut: -90, fin: 90 };
const fractionPuissance = (kw) => (Math.min(Math.max(kw, PUISSANCE_MIN), PUISSANCE_MAX) - PUISSANCE_MIN) / (PUISSANCE_MAX - PUISSANCE_MIN);

export function construire() {
  const d = arc(C.cx, C.cy, C.r, C.debut, C.fin);
  $('arc-fond').setAttribute('d', d);
  $('arc-vitesse').setAttribute('d', d);
  $('arc-vitesse').style.strokeDasharray = '0 1000';

  // Graduations tous les 10 km/h, chiffres tous les 20 km/h.
  let html = '';
  for (let v = 0; v <= VITESSE_MAX; v += 10) {
    const a = angleVitesse(v);
    const majeure = v % 20 === 0;
    const [x1, y1] = point(C.cx, C.cy, C.r - 12, a);
    const [x2, y2] = point(C.cx, C.cy, C.r - (majeure ? 22 : 17), a);
    html += `<line class="graduation${majeure ? ' majeure' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
    if (majeure) {
      const [tx, ty] = point(C.cx, C.cy, C.r - 33, a);
      html += `<text class="chiffre" x="${tx}" y="${ty}">${v}</text>`;
    }
  }
  $('graduations').innerHTML = html;

  $('puiss-fond').setAttribute('d', arc(P.cx, P.cy, P.r, P.debut, P.fin));
  const z = fractionPuissance(0);
  const [zx1, zy1] = point(P.cx, P.cy, P.r - 9, P.debut + z * 180);
  const [zx2, zy2] = point(P.cx, P.cy, P.r + 9, P.debut + z * 180);
  Object.entries({ x1: zx1, y1: zy1, x2: zx2, y2: zy2 }).forEach(([k, v]) => $('puiss-zero').setAttribute(k, v));
}

let derniereLimite = null;

/** Met à jour tout l'écran à partir de l'état courant. */
export function afficher(e) {
  // Vitesse
  const depasse = e.limitKmh != null && e.speedKmh > e.limitKmh + 3;
  $('vitesse').textContent = nombre(e.speedKmh);
  $('vitesse').classList.toggle('depasse', depasse);
  $('arc-vitesse').style.strokeDasharray = `${(Math.min(e.speedKmh, VITESSE_MAX) / VITESSE_MAX) * 1000} 1000`;
  $('arc-vitesse').classList.toggle('depasse', depasse);
  $('arc-vitesse').style.opacity = e.speedKmh >= 1 ? 1 : 0; // évite un point lumineux à l'arrêt

  // Limitation
  $('limite-val').textContent = e.limitKmh ?? '--';
  $('limite').classList.toggle('inconnue', e.limitKmh == null);
  if (e.limitKmh !== derniereLimite) {
    $('limite').classList.add('change');
    setTimeout(() => $('limite').classList.remove('change'), 400);
    derniereLimite = e.limitKmh;
  }
  const repere = $('repere-limite');
  if (e.limitKmh != null) {
    const a = angleVitesse(e.limitKmh);
    const [x1, y1] = point(C.cx, C.cy, C.r - 8, a);
    const [x2, y2] = point(C.cx, C.cy, C.r + 8, a);
    Object.entries({ x1, y1, x2, y2 }).forEach(([k, v]) => repere.setAttribute(k, v));
    repere.style.display = '';
  } else {
    repere.style.display = 'none';
  }
  $('route').textContent = [e.roadRef, e.roadName].filter(Boolean).join(' · ');

  // Régulateur
  $('regul-val').textContent = nombre(e.cruiseKmh);
  $('volant').toggleAttribute('hidden', !e.autopilotActif); // dessin SVG : la propriété .hidden n'existe pas
  $('regulateur').classList.toggle('actif', e.cruiseKmh != null);

  // Batterie
  $('batterie-val').textContent = nombre(e.batteryPct);
  $('batterie-niveau').style.width = `${Math.min(100, Math.max(0, e.batteryPct ?? 0))}%`;
  $('batterie').classList.toggle('faible', e.batteryPct != null && e.batteryPct <= 20 && e.batteryPct > 10);
  $('batterie').classList.toggle('critique', e.batteryPct != null && e.batteryPct <= 10);

  // Puissance : l'arc part du zéro et va vers la valeur (à gauche = récupération)
  const angleZero = P.debut + fractionPuissance(0) * 180;
  const angleVal = P.debut + fractionPuissance(e.powerKw ?? 0) * 180;
  const puissArc = $('puiss-arc');
  if (Math.abs(angleVal - angleZero) < 0.5) {
    puissArc.style.display = 'none';
  } else {
    puissArc.style.display = '';
    puissArc.setAttribute('d', arc(P.cx, P.cy, P.r, Math.min(angleZero, angleVal), Math.max(angleZero, angleVal)));
  }
  puissArc.classList.toggle('recup', (e.powerKw ?? 0) < 0);
  $('puissance').textContent = textePuissance(e.powerKw); // 4 caractères : la ligne ne bouge pas

  // Consommation
  $('conso-inst').textContent = texteConsoInstantanee(e.instantKwh100); // 4 caractères : le pavé ne change pas de taille
  $('barre-inst').style.width = `${Math.min(100, Math.max(0, ((e.instantKwh100 ?? 0) / CONSO_BARRE_MAX) * 100))}%`;
  $('conso-moy').textContent = nombre(e.moyenneKwh100, 1);

  // Trajet
  $('distance').textContent = nombre(e.distanceKm, 1);
  $('energie').textContent = nombre(e.energieKwh, 1);
  const min = Math.floor(e.dureeS / 60);
  $('duree').textContent = `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`;

  // Vent
  const vent = document.querySelector('.vent');
  if (e.vent) {
    // La flèche est dessinée pour un vent venant de l'avant (soufflant vers l'arrière, rotationFleche = 180°) :
    // on la tourne donc de rotationFleche - 180°, soit exactement l'angle d'où vient le vent.
    $('vent-fleche').style.transform = `rotate(${e.vent.rotationFleche - 180}deg)`;
    $('vent-fleche').style.display = '';
    $('vent-libelle').textContent = e.vent.libelle;
    $('vent-vitesse').textContent = nombre(e.vent.vitesse);
    vent.classList.toggle('face', e.vent.face > 5);
    vent.classList.toggle('arriere', e.vent.face < -5);
  } else {
    $('vent-fleche').style.display = 'none';
    $('vent-libelle').textContent = 'Vent';
    $('vent-vitesse').textContent = '--';
  }
  $('temperature').textContent = nombre(e.temperature);

  // Navigation (données de l'itinéraire Tesla)
  const n = e.navigation;
  $('nav-dest').textContent = n.destinationNom || (n.active ? 'Itinéraire en cours' : 'Aucune destination');
  $('nav-heure').textContent = n.heureArrivee ? n.heureArrivee.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '--:--';
  $('nav-km').textContent = nombre(n.kmArrivee, n.kmArrivee != null && n.kmArrivee < 10 ? 1 : 0);
  $('nav-duree').textContent = n.minutesArrivee == null ? '--'
    : n.minutesArrivee < 60 ? `${Math.round(n.minutesArrivee)} min`
    : `${Math.floor(n.minutesArrivee / 60)} h ${String(Math.round(n.minutesArrivee % 60)).padStart(2, '0')}`;
  $('nav-trafic').textContent = n.retardTraficMin == null ? '--' : `+${nombre(n.retardTraficMin)}`;
  $('nav-trafic-bloc').classList.toggle('retard', (n.retardTraficMin ?? 0) >= 5);
  $('nav-batterie').textContent = nombre(n.batterieArriveePct);
  $('nav-bas').hidden = !n.active;
  if (modeNavigation) majCarte(e.carte);

  // Diagnostic du flux Tesla
  const diag = $('diag-tesla');
  diag.hidden = !e.diagTesla;
  const lignesTeslogic = (b) => !b ? [] : [
    `Boîtier Teslogic : ${b.etat} · ${b.paquets} paquets (dernier ${b.dernier ? `il y a ${Math.round((Date.now() - b.dernier) / 1000)} s` : 'jamais'})`,
    `CAN : ${Object.entries(b.brut).map(([nom, v]) => `${nom}=${typeof v === 'number' ? Math.round(v * 10) / 10 : v ?? '∅'}`).join(', ') || 'rien'}`,
    ...b.journal, '',
  ];
  if (e.diagTesla) {
    const d = e.diagTesla;
    const ilya = (t) => (t ? `il y a ${Math.round((Date.now() - t) / 1000)} s` : 'jamais');
    diag.textContent = lignesTeslogic(e.diagTeslogic).join('\n') + (d.connexions == null
      ? `Flux Tesla : ${d.etat}${d.etat === 'simulation' ? ' (mode démo)' : ' (pas de clé MyTeslaMate, ou flux coupé : ajouter ?flux=1)'}`
      : [
        `Flux Tesla (${d.source ?? 'MyTeslaMate'}) : ${d.etat} · véhicule ${d.vin ?? '?'}`,
        `Connexion ${d.ouverte ? 'ouverte' : 'fermée'} · ${d.connexions} tentative(s)`,
        `Messages : ${d.messages} (dernier ${ilya(d.dernierMessage)})`,
        `Données : ${d.mises} mises à jour, ${d.signaux} signaux (dernière ${ilya(d.derniereMise)})`,
        `Champs : ${Object.entries(d.champs ?? {}).map(([nom, c]) => `${nom}×${c.n}=${c.valeur}${c.n > 1 ? ` (/${c.intervalleS} s)` : ''}`).join(', ') || 'aucun'}`,
        '', ...d.journal,
      ].join('\n'));
  }

  // Heure et pastilles d'état
  $('heure').textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  $('st-osm').textContent = `Limites · ${e.sourceLimite === 'Mapbox' || e.sourceLimite === 'Voiture' ? e.sourceLimite : 'OSM'}`;
  for (const [id, etat] of Object.entries(e.statuts)) {
    $(id).className = `pastille ${etat}`;
  }
}

let modeNavigation = false;

/** Passe en écran partagé (carte + compteurs compacts) ou revient au compteur seul. */
export function afficherModeNavigation(ouvert, jetonMapbox, position) {
  modeNavigation = ouvert;
  $('cockpit').classList.toggle('navigation', ouvert);
  if (ouvert) {
    ouvrirCarte($('carte'), jetonMapbox, $('carte-message'), position).then(redimensionnerCarte);
  }
}
addEventListener('resize', redimensionnerCarte); // rotation du téléphone

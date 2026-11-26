import { test, egal, proche, vrai } from './harness.js';
import { comprendreReseau, navigationTeslemetry, choisirBornes, phraseProposition, borneConnue, positionVehicule, bornesAutour, phraseAutour } from '../src/lib/bornes.js';
import { encoderPolyline } from '../src/lib/navigation.js';

// Itinéraire fictif plein ouest le long du parallèle 45° ; prochain arrêt (un Superchargeur) au bout.
const ARRET = { nom: 'Superchargeur', lat: 45, lon: 0.5 };
const TRACE = [{ lat: 45, lon: 1 }, { lat: 45, lon: 0.75 }, { lat: 45, lon: 0.5 }];
const B = (reseau, nom, lat, lon) => ({ reseau, nom, lat, lon, kw: 300, pdc: 6 });
const BORNES = [
  B('tesla', 'Arrêt prévu', 45, 0.5001), // la borne déjà prévue : jamais proposée
  B('electra', 'Loin de la route', 45.1, 0.5), // ~11 km au nord de l'arrêt
  B('electra', 'Sur la route', 45.002, 0.7), // ~16 km de l'arrêt, mais à 200 m de l'itinéraire
  B('electra', 'Hors rayon', 45, -0.2), // ~55 km
  B('electra', 'Gros détour', 44.84, 0.5), // ~18 km au sud de l'arrêt : détour estimé ~46 km
  B('ionity', 'Partenaire', 45.001, 0.55),
  B('tesla', 'Autre superchargeur', 45.01, 0.6),
];

test('bornes : réseau compris dans la phrase dictée', () => {
  egal(comprendreReseau('Électra'), 'electra');
  egal(comprendreReseau('une borne electra s\'il te plaît'), 'electra');
  egal(comprendreReseau('Superchargeur'), 'tesla');
  egal(comprendreReseau('Tesla'), 'tesla');
  egal(comprendreReseau('Ionity'), 'ionity');
  egal(comprendreReseau('banane'), null);
  egal(comprendreReseau(undefined), null);
});

test('bornes : navigation lue dans la télémétrie Teslemetry (format réel)', () => {
  const routeLine = btoa(encoderPolyline(TRACE));
  const nav = navigationTeslemetry({ data: {
    DestinationName: { value: 'Superchargeur', createdAt: '2026-11-25T17:25:24Z' },
    DestinationLocation: { value: { latitude: 45, longitude: 0.5 } },
    RouteLine: { value: routeLine },
  } });
  egal(nav.arret.nom, 'Superchargeur');
  egal(nav.arret.lat, 45);
  egal(nav.trace.length, 3);
  // Sans destination (valeur réelle observée : nom vide, position restée en cache) → pas de navigation
  egal(navigationTeslemetry({ data: { DestinationName: { value: null }, DestinationLocation: { value: { latitude: 48.6, longitude: 2.32 } }, RouteLine: { value: 'EgcNJeoJPxAB' } } }), null);
  egal(navigationTeslemetry({}), null);
});

test('bornes : Electra demandée → la plus proche de l\'itinéraire d\'abord, l\'arrêt prévu et le hors-rayon exclus', () => {
  const r = choisirBornes(BORNES, { reseau: 'electra', arret: ARRET, trace: TRACE });
  egal(r.map((b) => b.nom).join(','), 'Sur la route,Loin de la route');
  vrai(r[0].detourKm < 1, `détour ${r[0].detourKm}`);
  proche(r[0].distanceArretKm, 15.8, 0.3);
});

test('bornes : sans itinéraire, classement par distance à l\'arrêt', () => {
  const r = choisirBornes(BORNES, { reseau: 'electra', arret: ARRET });
  egal(r[0].nom, 'Loin de la route');
});
test('bornes : un détour trop grand n\'est jamais proposé', () => {
  vrai(!choisirBornes(BORNES, { reseau: 'electra', arret: ARRET, trace: TRACE }).some((b) => b.nom === 'Gros détour'));
  egal(choisirBornes([B('electra', 'Gros détour', 44.84, 0.5)], { reseau: 'electra', arret: ARRET, trace: TRACE }).length, 0);
});

test('bornes : partenaires seulement si le réseau demandé n\'a rien dans le rayon', () => {
  const sansElectra = BORNES.filter((b) => b.reseau !== 'electra');
  egal(choisirBornes(sansElectra, { reseau: 'electra', arret: ARRET, trace: TRACE })[0].nom, 'Partenaire');
  egal(choisirBornes(BORNES, { reseau: 'tesla', arret: ARRET, trace: TRACE })[0].nom, 'Autre superchargeur');
  egal(choisirBornes([], { reseau: 'electra', arret: ARRET }).length, 0);
});

test('bornes : phrase lue par Siri', () => {
  const [b] = choisirBornes(BORNES, { reseau: 'electra', arret: ARRET, trace: TRACE });
  egal(phraseProposition(b, 'electra'), 'Electra Sur la route, 300 kilowatts, à 16 kilomètres de l\'arrêt prévu, sans détour. Je l\'envoie à la voiture ?');
  const p = phraseProposition({ ...b, reseau: 'ionity', nom: 'IONITY Agen', detourKm: 4.26, distanceArretKm: 3.04 }, 'electra');
  egal(p, 'Pas de borne Electra proche. Ionity IONITY Agen, 300 kilowatts, à 3,0 kilomètres de l\'arrêt prévu, détour d\'environ 4,3 kilomètres. Je l\'envoie à la voiture ?');
});

test('bornes : seules les bornes de la liste peuvent être envoyées', () => {
  egal(borneConnue(BORNES, { lat: 45.00201, lon: 0.70001 }).nom, 'Sur la route');
  egal(borneConnue(BORNES, { lat: 48.85, lon: 2.35 }), null);
});

test('bornes : position de la voiture lue dans vehicle_data (cap seulement en roulant)', () => {
  const p = positionVehicule({ response: { drive_state: { latitude: 45, longitude: 0.6, heading: 270, speed: 60 } } });
  egal(p.lat, 45); egal(p.lon, 0.6); egal(p.cap, 270);
  egal(positionVehicule({ response: { drive_state: { latitude: 45, longitude: 0.6, heading: 270, speed: null } } }).cap, null);
  egal(positionVehicule({ response: { drive_state: {} } }), null);
  egal(positionVehicule({}), null);
});

test('bornes : sans navigation, bornes autour de la voiture (devant d\'abord en roulant)', () => {
  const ici = { lat: 45, lon: 0.6 }; // « Sur la route » ~8 km à l'est, « Loin de la route » ~14 km au nord-ouest, « Gros détour » ~19 km au sud-ouest
  const noms = (cap) => bornesAutour(BORNES, { reseau: 'electra', position: { ...ici, cap } }).map((b) => b.nom).join(',');
  egal(noms(null), 'Sur la route,Loin de la route,Gros détour'); // à l'arrêt : la plus proche
  egal(noms(90), 'Sur la route,Loin de la route,Gros détour'); // vers l'est
  egal(noms(270), 'Loin de la route,Sur la route,Gros détour'); // vers l'ouest : pas de demi-tour
  const [b] = bornesAutour(BORNES, { reseau: 'electra', position: { ...ici, cap: 90 } });
  egal(b.devant, true);
  proche(b.distanceKm, 7.9, 0.2);
  // Partenaires seulement si le réseau demandé n'a rien dans le rayon
  egal(bornesAutour(BORNES.filter((x) => x.reseau !== 'electra'), { reseau: 'electra', position: ici })[0].nom, 'Partenaire');
  egal(bornesAutour(BORNES, { reseau: 'electra', position: { lat: 48.85, lon: 2.35 } }).length, 0);
  // En roulant : un partenaire devant plutôt qu'un demi-tour vers une Electra ; demi-tour seulement s'il n'y a rien devant
  const derriere = [B('electra', 'Electra derrière', 45, 0.5), B('ionity', 'Ionity devant', 45, 0.7)];
  egal(bornesAutour(derriere, { reseau: 'electra', position: { ...ici, cap: 90 } })[0].nom, 'Ionity devant');
  egal(bornesAutour(derriere, { reseau: 'electra', position: ici })[0].nom, 'Electra derrière'); // à l'arrêt : le réseau demandé
  egal(bornesAutour(derriere.slice(0, 1), { reseau: 'electra', position: { ...ici, cap: 90 } })[0].devant, false);
});

test('bornes : phrase lue par Siri sans navigation', () => {
  const b = { reseau: 'electra', nom: 'Boulazac', kw: 150, distanceKm: 4.24 };
  egal(phraseAutour({ ...b, devant: true }, 'electra'), 'Electra Boulazac, 150 kilowatts, à 4,2 kilomètres à vol d\'oiseau devant toi. Je l\'envoie à la voiture ?');
  egal(phraseAutour({ ...b, devant: null }, 'electra'), 'Electra Boulazac, 150 kilowatts, à 4,2 kilomètres à vol d\'oiseau. Je l\'envoie à la voiture ?');
  egal(phraseAutour({ ...b, reseau: 'ionity', devant: false }, 'electra'), 'Pas de borne Electra proche. Ionity Boulazac, 150 kilowatts, à 4,2 kilomètres à vol d\'oiseau mais pas dans ta direction. Je l\'envoie à la voiture ?');
});

// Le Worker (relais/borne-worker.js) contient une copie de ces calculs : elle doit être à jour.
const texte = async (chemin) => (await fetch(chemin, { cache: 'no-store' })).text();
const sansModules = (t) => t.split('\n').filter((l) => !l.startsWith('import ')).map((l) => l.replace(/^export (default )?/, '')).join('\n');
const worker = await texte('../relais/borne-worker.js');
const copies = await Promise.all(['geo', 'navigation', 'bornes'].map(async (n) => [n, sansModules(await texte(`../src/lib/${n}.js`))]));
test('bornes : la copie des calculs dans le Worker est à jour (sinon : python3 outils/assembler-worker.py)', () => {
  for (const [nom, contenu] of copies) vrai(worker.includes(contenu), `copie de ${nom}.js périmée`);
});

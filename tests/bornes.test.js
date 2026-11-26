import { test, egal, proche, vrai } from './harness.js';
import { comprendreReseau, navigationTeslemetry, choisirBornes, phraseProposition, borneConnue } from '../src/lib/bornes.js';
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

// Le Worker (relais/borne-worker.js) contient une copie de ces calculs : elle doit être à jour.
const texte = async (chemin) => (await fetch(chemin, { cache: 'no-store' })).text();
const sansModules = (t) => t.split('\n').filter((l) => !l.startsWith('import ')).map((l) => l.replace(/^export (default )?/, '')).join('\n');
const worker = await texte('../relais/borne-worker.js');
const copies = await Promise.all(['geo', 'navigation', 'bornes'].map(async (n) => [n, sansModules(await texte(`../src/lib/${n}.js`))]));
test('bornes : la copie des calculs dans le Worker est à jour (sinon : python3 outils/assembler-worker.py)', () => {
  for (const [nom, contenu] of copies) vrai(worker.includes(contenu), `copie de ${nom}.js périmée`);
});

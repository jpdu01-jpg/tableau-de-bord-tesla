import { test, egal, vrai } from './harness.js';
import {
  ajouterATrace, urlMapMatching, parseMapboxMaxspeed, limiteFinDeTrace, compterRequete, quotaAtteint,
  TRACE_MAX_POINTS, QUOTA_MENSUEL_MAX,
} from '../src/lib/mapbox.js';

const pt = (lat, t, accuracy = 5) => ({ lat, lon: 3, accuracy, t });

test('trace : ajoute une position éloignée', () => egal(ajouterATrace([pt(48, 0)], pt(48.001, 1000)).length, 2));
test('trace : ignore une position trop proche (< 20 m)', () => egal(ajouterATrace([pt(48, 0)], pt(48.0001, 1000)).length, 1));
test('trace : ignore une position imprécise', () => egal(ajouterATrace([], pt(48, 0, 100)).length, 0));
test('trace : garde seulement les dernières positions', () => {
  let trace = [];
  for (let i = 0; i < 20; i++) trace = ajouterATrace(trace, pt(48 + i * 0.001, i * 1000));
  egal(trace.length, TRACE_MAX_POINTS);
  egal(trace[trace.length - 1].lat, 48 + 19 * 0.001);
});

test('url : coordonnées « longitude,latitude » et clé encodée', () => {
  const url = urlMapMatching([pt(48, 1000), pt(48.001, 2000)], 'pk.a/b');
  vrai(url.includes('/mapbox/driving/3.000000,48.000000;3.000000,48.001000?'), url);
  vrai(url.includes('annotations=maxspeed'));
  vrai(url.includes('access_token=pk.a%2Fb'));
});
test('url : horodatages strictement croissants même si identiques', () => {
  const url = urlMapMatching([pt(48, 1000), pt(48.001, 1200), pt(48.002, 1500)], 'k');
  vrai(url.includes('timestamps=1;2;3'), url);
});

test('maxspeed Mapbox : 130 km/h', () => egal(parseMapboxMaxspeed({ speed: 130, unit: 'km/h' }), 130));
test('maxspeed Mapbox : 50 mph → 80 km/h', () => egal(parseMapboxMaxspeed({ speed: 50, unit: 'mph' }), 80));
test('maxspeed Mapbox : inconnue → null', () => egal(parseMapboxMaxspeed({ unknown: true }), null));
test('maxspeed Mapbox : illimitée → null', () => egal(parseMapboxMaxspeed({ none: true }), null));

const reponse = (maxspeeds, extra = {}) => ({
  code: 'Ok',
  matchings: [{ confidence: 0.9, legs: [{ summary: 'A6', annotation: { maxspeed: maxspeeds } }], ...extra }],
});
test('réponse : prend la dernière portion connue', () =>
  egal(limiteFinDeTrace(reponse([{ speed: 110, unit: 'km/h' }, { speed: 130, unit: 'km/h' }])).limit, 130));
test('réponse : ignore les portions inconnues en fin de trace', () =>
  egal(limiteFinDeTrace(reponse([{ speed: 90, unit: 'km/h' }, { unknown: true }])).limit, 90));
test('réponse : nom de la route', () => egal(limiteFinDeTrace(reponse([{ speed: 90, unit: 'km/h' }])).name, 'A6'));
test('réponse : confiance trop faible → null', () =>
  egal(limiteFinDeTrace(reponse([{ speed: 90, unit: 'km/h' }], { confidence: 0.01 })), null));
test('réponse : erreur Mapbox → null', () => egal(limiteFinDeTrace({ code: 'NoMatch' }), null));

const NOV = Date.UTC(2026, 10, 23), DEC = Date.UTC(2026, 11, 1);
test('compteur : premier appel du mois', () => egal(compterRequete(null, NOV).n, 1));
test('compteur : incrémente dans le même mois', () => egal(compterRequete({ mois: '2026-11', n: 41 }, NOV).n, 42));
test('compteur : remis à zéro au changement de mois', () => egal(compterRequete({ mois: '2026-11', n: 500 }, DEC).n, 1));
test('quota : atteint', () => egal(quotaAtteint({ mois: '2026-11', n: QUOTA_MENSUEL_MAX }, NOV), true));
test('quota : nouveau mois → plus atteint', () => egal(quotaAtteint({ mois: '2026-11', n: QUOTA_MENSUEL_MAX }, DEC), false));

import { test, egal, vrai } from './harness.js';
import { parseMaxspeed, limitForDirection, matchWay } from '../src/lib/maxspeed.js';

test('maxspeed « 130 » → 130', () => egal(parseMaxspeed('130'), 130));
test('maxspeed « 50 mph » → 80 km/h', () => egal(parseMaxspeed('50 mph'), 80));
test('maxspeed « FR:urban » → 50', () => egal(parseMaxspeed('FR:urban'), 50));
test('maxspeed « FR:rural » → 80', () => egal(parseMaxspeed('FR:rural'), 80));
test('maxspeed « 90;110 » → 90', () => egal(parseMaxspeed('90;110'), 90));
test('maxspeed « none » → null', () => egal(parseMaxspeed('none'), null));
test('maxspeed absent → null', () => egal(parseMaxspeed(undefined), null));
test('limitation par sens : forward', () =>
  egal(limitForDirection({ maxspeed: '80', 'maxspeed:forward': '70' }, true), 70));
test('limitation par sens : backward absent → maxspeed', () =>
  egal(limitForDirection({ maxspeed: '80', 'maxspeed:forward': '70' }, false), 80));

// Deux voies parallèles d'autoroute (une par sens) et une bretelle.
const sud = { tags: { highway: 'motorway', maxspeed: '130', ref: 'A 6' }, geometry: [{ lat: 48.01, lon: 3.0 }, { lat: 48.0, lon: 3.0 }] };
const nord = { tags: { highway: 'motorway', maxspeed: '110', ref: 'A 6' }, geometry: [{ lat: 48.0, lon: 3.0003 }, { lat: 48.01, lon: 3.0003 }] };
const bretelle = { tags: { highway: 'motorway_link', maxspeed: '70' }, geometry: [{ lat: 48.0, lon: 3.0006 }, { lat: 48.01, lon: 3.0006 }] };
const ways = [sud, nord, bretelle];
const pos = { lat: 48.005, lon: 3.00015 }; // pile entre les deux chaussées

test('roulant vers le sud → chaussée sud (130)', () => egal(matchWay(ways, pos, 180).limit, 130));
test('roulant vers le nord → chaussée nord (110)', () => egal(matchWay(ways, pos, 0).limit, 110));
test('aucune route proche → null', () => egal(matchWay(ways, { lat: 48.1, lon: 3.1 }, 0), null));
test('route à double sens : limitation backward en sens inverse', () => {
  const route = { tags: { highway: 'primary', maxspeed: '80', 'maxspeed:backward': '50' }, geometry: [{ lat: 48, lon: 3 }, { lat: 48.01, lon: 3 }] };
  egal(matchWay([route], { lat: 48.005, lon: 3 }, 180).limit, 50);
  egal(matchWay([route], { lat: 48.005, lon: 3 }, 0).limit, 80);
});
test('cap inconnu : la route la plus proche gagne', () => vrai(matchWay([sud, nord], { lat: 48.005, lon: 3.00002 }, null).way === sud));

// Service worker : permet d'ouvrir l'application même sans réseau (zones blanches sur autoroute).
// Stratégie « réseau d'abord » pour les fichiers de l'app : la dernière version est toujours utilisée
// quand le réseau est là, la copie locale sert de secours. Les données (cartes, météo) ne sont jamais mises en cache.
const CACHE = 'tableau-de-bord-v15';
const FICHIERS = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-180.png',
  'src/app.js', 'src/ui.js', 'src/lib/geo.js', 'src/lib/maxspeed.js', 'src/lib/trip.js', 'src/lib/wind.js',
  'src/sources/gps.js', 'src/sources/speedLimit.js', 'src/sources/weather.js', 'src/sources/tesla.js',
  'src/sources/simulation.js', 'src/sources/route-demo.js', 'src/lib/mapbox.js', 'src/sources/mapboxLimit.js',
  'src/lib/teslaStream.js', 'src/sources/myteslamate.js', 'src/lib/navigation.js', 'src/carte.js', 'src/lib/format.js', 'src/lib/can.js', 'src/sources/teslogic.js', 'src/lib/teslemetry.js', 'src/sources/teslemetry.js', 'src/lib/historique.js', 'src/lib/sauvegarde.js', 'src/sources/sauvegarde.js', 'historique.html', 'src/historique-page.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FICHIERS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((cles) => Promise.all(cles.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== 'GET') return; // API externes : pas de cache
  e.respondWith(
    fetch(e.request)
      .then((rep) => {
        const copie = rep.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie));
        return rep;
      })
      .catch(() => caches.match(e.request)),
  );
});

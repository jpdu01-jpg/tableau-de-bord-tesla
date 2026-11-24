# Tableau de bord Tesla — règles du projet

Application web installable (PWA) qui affiche un tableau de bord de voyage sur iPhone et Mac, pour une Tesla Model Y.
Le propriétaire du projet apprend le développement : explique les choix en français, simplement.

## Architecture
- HTML/CSS/JavaScript **sans outil de build ni dépendance npm** (Node n'est pas installé). Modules ES natifs.
- `src/lib/` : calculs purs, sans accès au réseau ni au navigateur. **Tout calcul doit vivre ici et être testé.**
- `src/sources/` : sources de données (GPS du téléphone, OpenStreetMap, Open-Meteo, Tesla, simulation).
- `src/ui.js` : affichage uniquement, aucun calcul métier.
- `src/carte.js` : affichage de la carte de navigation (Mapbox GL JS chargé depuis le site de Mapbox, même clé que les limitations).
- `src/app.js` : relie les sources, les calculs et l'affichage.
- Répartition des données (choix validé) :
  - téléphone (GPS) → vitesse, cap, distance ;
  - Mapbox Map Matching → limitation de vitesse (source principale, clé saisie dans l'app, 1 requête / 3 s max, coupé à 90 000 requêtes/mois) ;
  - OpenStreetMap (Overpass) → limitation de vitesse en secours (pas de clé, quota atteint ou Mapbox injoignable) ;
  - Open-Meteo → vent ;
  - Tesla via **Teslemetry** (`src/sources/teslemetry.js`, décodage `src/lib/teslemetry.js`) : flux SSE gratuit, plusieurs abonnés possibles (pas de conflit avec TeslaMate), champs choisis dans la console Teslemetry (`CHAMPS_TESLEMETRY`). Prioritaire sur MyTeslaMate quand un jeton est enregistré. Teslemetry n'autorise pas les pages web (pas de CORS) : passage par un relais Cloudflare Worker (`relais/teslemetry-worker.js`, sans secret, adresse saisie dans les Réglages).
  - Tesla (via MyTeslaMate, flux brut « subscribe_all » des champs configurés dans `docs/telemetrie/config-telemetrie.json`) → puissance (champ Power ajouté par MyTeslaMate), niveau de batterie (BatteryLevel / Soc) et navigation (DestinationName, DestinationLocation, RouteLine, MinutesToArrival, MilesToArrival, RouteTrafficMinutesDelay, ExpectedEnergyPercentAtTripArrival).
  - Boîtier Teslogic V2 (`src/sources/teslogic.js`, décodage `src/lib/can.js` ; Bluetooth, trames CAN, gratuit) → **prioritaire** pour puissance, vitesse, batterie, régulateur et limitation de vitesse lue par la voiture (Mapbox reste interrogé pour le nom de la rue). Safari iPhone n'a pas le Bluetooth web : utiliser le navigateur Bluefy. Connexion au toucher de « Démarrer le trajet » ou de la pastille « Voiture ».
- Écran de navigation : toucher l'écran bascule compteur seul ↔ écran partagé carte + compteurs ; une destination saisie dans la Tesla l'ouvre automatiquement, sa suppression le ferme.
- Le streaming Tesla est facturé par signal : ne jamais ajouter de champ Tesla sans le signaler et estimer son coût.

## Règles de modification
- Changements minimaux : ne modifier que ce que la demande concerne. Pas de refactoring ni de « nettoyage » non demandé.
- Ne pas modifier `src/lib/` sans mettre à jour ou ajouter les tests correspondants dans `tests/`.
- Avant de dire qu'une tâche est finie : ouvrir `tests/index.html` dans le navigateur et vérifier que **tous les tests passent**.
- Ne jamais commiter sans que l'utilisateur l'ait demandé.
- Ne jamais écrire de jeton, mot de passe ou clé API dans le code ou dans git. Les secrets se saisissent dans l'app et restent dans le stockage local du navigateur.
- Le mode démo (`?demo=1`) doit toujours fonctionner : c'est lui qui permet de tester sans rouler.

## Lancer en local
`python3 serveur.py` (serveur sans cache, pour voir chaque modification immédiatement), puis http://localhost:8173 (démo : http://localhost:8173/?demo=1, tests : http://localhost:8173/tests/).

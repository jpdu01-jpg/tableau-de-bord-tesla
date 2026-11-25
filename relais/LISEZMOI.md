# Relais Teslemetry (Cloudflare Workers, gratuit)

Teslemetry n'autorise pas les pages web à lire ses réponses (pas d'en-tête CORS). Ce petit relais, hébergé
gratuitement chez Cloudflare, transmet les requêtes de l'app à Teslemetry et ajoute cette autorisation.

Il ne contient aucun secret : le jeton Teslemetry reste dans l'app. Il n'accepte que les pages de l'app et ne
relaie que la lecture (véhicules, configuration, flux) : aucune commande vers la voiture n'est possible.

## Installation (une seule fois, environ 5 minutes)

1. Sur dash.cloudflare.com : **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker**.
2. Nom : `relais-teslemetry` → **Deploy** (Cloudflare crée un Worker d'exemple « Hello World »).
3. **Edit code** : effacer tout le contenu, coller celui de `teslemetry-worker.js`, puis **Deploy**.
4. Copier l'adresse du Worker, de la forme `https://relais-teslemetry.<ton-sous-domaine>.workers.dev`.
5. Dans l'app : **Réglages** → « Adresse du relais Teslemetry » → coller l'adresse → **Enregistrer**,
   puis **Tester la connexion Teslemetry**.

## Vérification rapide

En ouvrant l'adresse du Worker directement dans un navigateur, la page affiche « Origine refusée » :
c'est normal, le relais ne répond qu'à l'app.

## Coût

Offre gratuite Cloudflare Workers : 100 000 requêtes par jour. L'app en fait quelques-unes par trajet
(le flux temps réel est une seule requête qui reste ouverte).

---

# Sauvegarde des trajets (Cloudflare Workers + D1, gratuit)

L'historique des trajets est rangé dans Safari, sur le téléphone seulement. Ce second Worker en garde une copie dans
une petite base de données Cloudflare (D1) : rien n'est perdu si les données de Safari sont effacées, et l'historique
peut être récupéré sur le Mac ou l'iPad.

Contrairement au relais Teslemetry, ce Worker **garde des données personnelles** (heures, destinations) : il est
protégé par un **mot de passe**, enregistré comme secret dans Cloudflare (jamais dans le code) et saisi dans l'app.

## Installation (une seule fois, environ 10 minutes)

1. **Choisir un mot de passe long** (au moins 20 caractères), par exemple celui proposé par l'app Mots de passe du
   Mac. Le garder dans l'app Mots de passe : il servira deux fois, ci-dessous.
2. **Créer la base** : sur dash.cloudflare.com, **Storage & Databases** → **D1 SQL Database** → **Create** →
   nom `trajets` → **Create**. (La table est créée automatiquement par le Worker : rien à saisir ensuite.)
3. **Créer le Worker** : **Compute (Workers)** → **Workers & Pages** → **Create** → **Create Worker** →
   nom `sauvegarde-trajets` → **Deploy**.
4. **Edit code** : effacer tout le contenu, coller celui de `sauvegarde-worker.js`, puis **Deploy**.
5. **Relier la base** : dans le Worker, onglet **Bindings** (ou **Settings** → **Bindings**) → **Add binding** →
   **D1 database** → nom de variable `DB` → base `trajets` → **Add binding**.
6. **Ajouter le mot de passe** : **Settings** → **Variables and Secrets** → **Add** → type **Secret** →
   nom `MOT_DE_PASSE` → valeur : le mot de passe de l'étape 1 → **Deploy**.
7. Copier l'adresse du Worker, de la forme `https://sauvegarde-trajets.<ton-sous-domaine>.workers.dev`.
8. Dans l'app : **Réglages** → « Sauvegarde en ligne des trajets » → coller l'adresse et le mot de passe →
   **Enregistrer**. Le message « Sauvegarde réussie » apparaît dans **Historique des trajets**.

## Utilisation

- La sauvegarde est automatique : à la fin de chaque trajet, toutes les 5 minutes en roulant, et à l'ouverture de
  l'app (pour rattraper un envoi raté faute de réseau). Seuls les trajets nouveaux ou modifiés sont envoyés.
- Sur un autre appareil (Mac, iPad) ou après avoir vidé Safari : saisir la même adresse et le même mot de passe,
  puis **Récupérer la sauvegarde**. Les trajets sont réunis avec ceux déjà présents, sans doublon.
- « Effacer » dans l'historique n'efface que le téléphone : la sauvegarde en ligne est conservée.
- Les trajets du mode démonstration ne sont jamais envoyés.
- Changer de mot de passe : modifier le secret `MOT_DE_PASSE` dans Cloudflare, puis le saisir de nouveau dans l'app.

## Vérification rapide

En ouvrant l'adresse du Worker dans un navigateur, la page affiche « Origine refusée » : c'est normal.

## Coût

Offre gratuite D1 : 5 Go de stockage (un trajet fait moins d'1 Ko) et largement assez de lectures et d'écritures
par jour ; Workers : 100 000 requêtes par jour, pour quelques-unes par trajet.

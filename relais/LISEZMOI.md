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

---

# Changement de borne à la voix (Cloudflare Workers + raccourci Siri)

« **Dis Siri, change de borne** » → « Quel réseau ? » → « **Electra** » → Siri propose la meilleure borne près du
prochain arrêt de la Tesla (« Electra Boulazac, 150 kilowatts, à 3,7 kilomètres de l'arrêt prévu… Je l'envoie ? »)
→ « **Oui** » → la Tesla reçoit la nouvelle destination.

- Réseaux : Tesla ou Electra en premier ; à défaut, les partenaires Electra (Ionity, Atlante). Jamais une borne
  demandant un détour de plus de 30 km.
- La commande **remplace le trajet** : la suite du voyage est à reprogrammer à la borne (choix : `ORDRE` en haut de
  `borne-worker.modele.js`, 2 = ajouter comme prochain arrêt en gardant la suite).
- **Sans navigation en cours** : la borne est cherchée autour de la voiture (jusqu'à 50 km ; en roulant, celles
  devant d'abord). La position est demandée à la voiture une seule fois (quelques crédits Teslemetry) ; si elle
  dort, Siri le dit et rien n'est proposé.
- Liste des bornes : `data/bornes.json` (base nationale des IRVE), mise à jour avec `python3 outils/bornes.py`.

**Sécurité** : ce Worker peut envoyer une commande à la voiture. Il ne fait que de la navigation, et seulement vers une
borne de la liste. Il est protégé par un mot de passe (différent de celui de la sauvegarde) et contient ton jeton
Teslemetry, tous deux en **secrets** Cloudflare, jamais dans le code.

## 1. Le Worker (environ 5 minutes)

1. Choisir un **nouveau mot de passe long** (app Mots de passe).
2. dash.cloudflare.com → **Workers & Pages** → **Create** → **Create Worker** → nom `borne-voix` → **Deploy**.
3. **Edit code** : effacer tout, coller le contenu de **`borne-worker.js`** (pas le fichier « modele »), **Deploy**.
4. **Settings** → **Variables and Secrets** → **Add**, deux fois, type **Secret** :
   - `MOT_DE_PASSE` : le mot de passe de l'étape 1 ;
   - `TESLEMETRY_JETON` : ton jeton d'accès Teslemetry (console Teslemetry, le même que dans l'app).
   Puis **Deploy**.
5. Noter l'adresse : `https://borne-voix.<ton-sous-domaine>.workers.dev`.

## 2. Le raccourci Siri (environ 10 minutes, sur l'iPhone)

App **Raccourcis** → **+** → nommer le raccourci **Change de borne** (c'est la phrase à dire à Siri). Ajouter, dans
l'ordre :

1. **Demander une saisie** : type *Texte*, invite « Quel réseau ? ».
2. **Obtenir le contenu de l'URL** : adresse `https://borne-voix.<ton-sous-domaine>.workers.dev/proposer`. Toucher
   « Afficher plus » :
   - Méthode : **POST** ;
   - En-têtes : clé `Authorization`, valeur `Bearer ` suivi du mot de passe (avec l'espace après Bearer) ;
   - Corps de la requête : **JSON**, ajouter un champ *Texte* : clé `reseau`, valeur *Saisie fournie*.
3. **Obtenir la valeur du dictionnaire** : *Valeur* pour la clé `texte` dans *Contenu de l'URL*.
   Toucher la variable produite → **Renommer** → `Phrase`.
4. **Obtenir la valeur du dictionnaire** : *Valeur* pour la clé `borne` dans *Contenu de l'URL*.
   Renommer → `Borne`.
5. **Si** : *Borne* **a une valeur**.
6. (dans le « Si ») **Choisir dans le menu** : invite = la variable *Phrase* ; deux choix : `Oui` et `Non`.
7. Sous **Oui** : **Obtenir le contenu de l'URL** : même adresse mais finissant par `/envoyer`, méthode POST, même
   en-tête `Authorization`, corps JSON avec un champ *Texte* : clé `borne`, valeur la variable *Borne*.
   Puis **Obtenir la valeur du dictionnaire** `texte` de ce *Contenu de l'URL*, puis **Énoncer le texte**.
8. Sous **Non** : **Énoncer le texte** « D'accord, je ne change rien. »
9. Sous **Sinon** (pas de borne) : **Énoncer le texte** : la variable *Phrase* (Siri explique pourquoi).

Essai sans rouler : avec une destination saisie dans la Tesla (voiture éveillée), dire « Dis Siri, change de borne »
puis « Electra » et répondre **Non** : rien n'est envoyé. Répondre **Oui** envoie vraiment la destination.

## Messages possibles

- « Erreur : la Tesla est endormie… » : sans navigation, la position ne peut pas être lue quand la voiture dort.
- « Mot de passe refusé. » : l'en-tête `Authorization` du raccourci ne correspond pas au secret `MOT_DE_PASSE`.
- « Erreur : le jeton Teslemetry est refusé. » : secret `TESLEMETRY_JETON` incorrect ou jeton expiré.
- « La Tesla a refusé : … » : la voiture n'a pas accepté la commande (endormie, clé virtuelle Teslemetry absente…).

## Coût

Gratuit côté Cloudflare. Teslemetry : la lecture de la navigation est gratuite (données en cache, la voiture n'est
pas réveillée) ; l'envoi de la destination consomme quelques crédits de commande.

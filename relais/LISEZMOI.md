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

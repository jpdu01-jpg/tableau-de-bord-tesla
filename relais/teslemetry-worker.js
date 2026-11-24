// Relais Teslemetry pour Cloudflare Workers (à copier-coller dans l'éditeur du Worker, voir relais/LISEZMOI.md).
//
// Pourquoi : api.teslemetry.com n'autorise pas les pages web (pas d'en-tête CORS) ; le navigateur bloque donc ses
// réponses. Ce relais transmet les requêtes de l'app à Teslemetry et ajoute l'autorisation manquante.
//
// Sécurité :
//   - le relais ne contient AUCUN secret : le jeton Teslemetry reste dans l'app (stockage local du téléphone) et
//     voyage dans la requête, comme si l'app appelait Teslemetry directement ;
//   - seules les pages de l'app sont acceptées (ORIGINES) et seules 3 adresses en lecture sont relayées (CHEMINS) :
//     impossible de s'en servir pour envoyer des commandes à la voiture.

const ORIGINES = ['https://jpdu01-jpg.github.io', 'http://localhost:8173'];
const CHEMINS = [
  /^\/api\/metadata$/, // liste des véhicules
  /^\/api\/config\/[A-HJ-NPR-Z0-9]{17}$/, // configuration de streaming (VIN : 17 caractères)
  /^\/sse\/[A-HJ-NPR-Z0-9]{17}$/, // flux temps réel
];

export default {
  async fetch(requete) {
    const origine = requete.headers.get('Origin');
    if (!ORIGINES.includes(origine)) return new Response('Origine refusée', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origine, Vary: 'Origin' };

    if (requete.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    if (requete.method !== 'GET') return new Response('Méthode refusée', { status: 405, headers: cors });

    const url = new URL(requete.url);
    if (!CHEMINS.some((c) => c.test(url.pathname))) return new Response('Adresse refusée', { status: 404, headers: cors });

    const reponse = await fetch(`https://api.teslemetry.com${url.pathname}${url.search}`, {
      headers: { Accept: requete.headers.get('Accept') || '*/*' },
    });
    // Le corps est transmis au fil de l'eau : le flux temps réel (SSE) reste ouvert pendant tout le trajet.
    const entetes = new Headers(reponse.headers);
    for (const [nom, valeur] of Object.entries(cors)) entetes.set(nom, valeur);
    entetes.set('Cache-Control', 'no-store');
    return new Response(reponse.body, { status: reponse.status, headers: entetes });
  },
};

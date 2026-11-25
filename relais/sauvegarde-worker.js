// Sauvegarde de l'historique des trajets pour Cloudflare Workers + D1 (à copier-coller dans l'éditeur du Worker,
// voir relais/LISEZMOI.md, partie « Sauvegarde des trajets »).
//
// Pourquoi : l'historique est rangé dans Safari, sur le téléphone seulement. Ce Worker en garde une copie dans une
// petite base de données Cloudflare (D1, gratuite) : rien n'est perdu si Safari est vidé, et l'historique peut être
// récupéré sur un autre appareil (Mac, iPad).
//
// Sécurité : contrairement au relais Teslemetry, ce Worker GARDE des données personnelles (heures, destinations).
//   - Chaque requête doit porter le mot de passe (en-tête « Authorization: Bearer … »). Il n'est PAS dans ce code :
//     il est enregistré dans Cloudflare comme secret du Worker (MOT_DE_PASSE) et saisi dans les Réglages de l'app.
//   - Seules les pages de l'app sont acceptées (ORIGINES) et une seule adresse existe : /trajets (lire, enregistrer).
//
// Liaisons à configurer dans Cloudflare (Settings → Bindings / Variables and Secrets) :
//   DB           → la base D1 « trajets »
//   MOT_DE_PASSE → secret (type « Secret »)

const ORIGINES = ['https://jpdu01-jpg.github.io', 'http://localhost:8173'];
const TAILLE_MAX_OCTETS = 1_000_000; // un envoi raisonnable fait quelques dizaines de Ko

// La table est créée au premier appel : rien à saisir dans la console D1. Un trajet = une ligne, identifiée par son
// heure de départ ; le résumé complet est gardé tel quel (texte JSON), pour suivre les évolutions de l'app.
const CREER_TABLE = 'CREATE TABLE IF NOT EXISTS trajets (debut INTEGER PRIMARY KEY, fin INTEGER NOT NULL, donnees TEXT NOT NULL)';
// Ajoute ou met à jour tous les trajets reçus en UNE requête (l'offre gratuite limite le nombre de requêtes par appel).
// Une version plus ancienne d'un trajet (fin plus tôt) ne remplace jamais une plus récente.
const ENREGISTRER = `INSERT INTO trajets (debut, fin, donnees)
  SELECT json_extract(value, '$.debut'), json_extract(value, '$.fin'), value FROM json_each(?1) WHERE true
  ON CONFLICT (debut) DO UPDATE SET fin = excluded.fin, donnees = excluded.donnees WHERE excluded.fin >= trajets.fin`;

async function motDePasseValide(requete, attendu) {
  const recu = (requete.headers.get('Authorization') || '').replace(/^Bearer /, '');
  // Comparaison à durée constante (des empreintes de même longueur) : ne laisse pas deviner le mot de passe.
  const empreinte = async (t) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  const [a, b] = await Promise.all([empreinte(recu), empreinte(attendu)]);
  return recu.length > 0 && crypto.subtle.timingSafeEqual(a, b);
}

export default {
  async fetch(requete, env) {
    const origine = requete.headers.get('Origin');
    if (!ORIGINES.includes(origine)) return new Response('Origine refusée', { status: 403 });
    const cors = { 'Access-Control-Allow-Origin': origine, Vary: 'Origin' };
    const json = (donnees, status = 200) =>
      new Response(JSON.stringify(donnees), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    if (requete.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: {
        ...cors, 'Access-Control-Allow-Methods': 'GET, PUT', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Max-Age': '86400',
      } });
    }
    if (!env.DB || !env.MOT_DE_PASSE) return json({ erreur: 'Worker incomplet : relier la base D1 (DB) et le secret MOT_DE_PASSE' }, 500);
    if (new URL(requete.url).pathname !== '/trajets') return json({ erreur: 'Adresse inconnue' }, 404);
    if (!(await motDePasseValide(requete, env.MOT_DE_PASSE))) return json({ erreur: 'Mot de passe refusé' }, 401);

    await env.DB.prepare(CREER_TABLE).run();

    if (requete.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT donnees FROM trajets ORDER BY debut DESC').all();
      return json(results.map((r) => JSON.parse(r.donnees)));
    }
    if (requete.method === 'PUT') {
      const texte = await requete.text();
      if (texte.length > TAILLE_MAX_OCTETS) return json({ erreur: 'Envoi trop gros' }, 413);
      let trajets;
      try {
        trajets = JSON.parse(texte);
      } catch {
        return json({ erreur: 'Données illisibles' }, 400);
      }
      if (!Array.isArray(trajets)) return json({ erreur: 'Une liste de trajets est attendue' }, 400);
      const valides = trajets.filter((t) => t && Number.isFinite(t.debut) && Number.isFinite(t.fin));
      if (valides.length) await env.DB.prepare(ENREGISTRER).bind(JSON.stringify(valides)).run();
      return json({ enregistres: valides.length });
    }
    return json({ erreur: 'Méthode refusée' }, 405);
  },
};

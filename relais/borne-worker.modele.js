// Changement de borne à la voix pour Cloudflare Workers (à copier-coller dans l'éditeur du Worker, voir
// relais/LISEZMOI.md, partie « Changement de borne à la voix »). Appelé par un raccourci Siri.
//
//   « Dis Siri, change de borne » → « Quel réseau ? » → « Electra »
//   → POST /proposer { reseau: "Electra" } : lit le prochain arrêt de la Tesla (télémétrie en cache : gratuit, ne
//     réveille pas la voiture), choisit la meilleure borne, renvoie la phrase que Siri lit
//   → « Oui » → POST /envoyer { borne: "lat,lon" } : envoie la nouvelle destination au GPS de la Tesla.
//   Sans navigation en cours : la borne est cherchée autour de la voiture, dont la position est demandée une fois
//   (vehicle_data, quelques crédits ; ne réveille pas la voiture : si elle dort, rien n'est proposé).
//
// Sécurité : ce Worker PEUT envoyer une commande à la voiture. Il est donc limité à la navigation, et seulement vers
// une borne de la liste data/bornes.json (impossible d'envoyer la voiture ailleurs). Chaque appel doit porter le mot
// de passe (en-tête « Authorization: Bearer … »). Le jeton Teslemetry et le mot de passe ne sont PAS dans ce code :
// ce sont des secrets du Worker dans Cloudflare (TESLEMETRY_JETON, MOT_DE_PASSE).

const ADRESSE_BORNES = 'https://jpdu01-jpg.github.io/tableau-de-bord-tesla/data/bornes.json'; // publié avec l'app
const API = 'https://api.teslemetry.com';
// Ordre de la commande de navigation :
//   1 = remplacer tout le trajet (la suite du voyage est à reprogrammer à la borne) ;
//   2 = ajouter comme prochain arrêt (la suite est gardée, mais l'ancien arrêt aussi : à supprimer sur l'écran).
const ORDRE = 1;

//@@BIBLIOTHEQUE@@

async function motDePasseValide(requete, attendu) {
  const recu = (requete.headers.get('Authorization') || '').replace(/^Bearer /, '');
  // Comparaison à durée constante (des empreintes de même longueur) : ne laisse pas deviner le mot de passe.
  const empreinte = async (t) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)));
  const [a, b] = await Promise.all([empreinte(recu), empreinte(attendu)]);
  return recu.length > 0 && crypto.subtle.timingSafeEqual(a, b);
}

async function teslemetry(env, chemin, options = {}) {
  const rep = await fetch(API + chemin, {
    ...options,
    headers: { Authorization: `Bearer ${env.TESLEMETRY_JETON}`, 'Content-Type': 'application/json' },
  });
  if (rep.status === 401) throw new Error('le jeton Teslemetry est refusé');
  if (rep.status === 408) throw new Error('la Tesla est endormie, elle ne donne pas sa position');
  if (!rep.ok) throw new Error(`Teslemetry a répondu ${rep.status}`);
  return rep.json();
}

async function premierVin(env) {
  const vin = Object.keys((await teslemetry(env, '/api/metadata')).vehicles || {})[0];
  if (!vin) throw new Error('aucune voiture sur le compte Teslemetry');
  return vin;
}

async function lireBornes() {
  const rep = await fetch(ADRESSE_BORNES, { cf: { cacheTtl: 86400 } }); // gardée un jour en cache
  if (!rep.ok) throw new Error('liste des bornes illisible');
  return rep.json();
}

async function proposer(env, { reseau: texte, rang = 0 }) {
  const reseau = comprendreReseau(texte);
  if (!reseau) return { ok: false, texte: 'Je n\'ai pas compris le réseau. Dis Tesla, Electra, Ionity ou Atlante.' };
  const vin = await premierVin(env);
  const champs = encodeURIComponent('DestinationName;DestinationLocation;RouteLine');
  const telemetrie = await teslemetry(env, `/api/1/vehicles/${vin}/telemetry?fields=${champs}`);
  const nav = navigationTeslemetry(telemetrie.response ?? telemetrie);
  if (!nav) return proposerAutour(env, vin, reseau, rang);
  const b = choisirBornes(await lireBornes(), { reseau, arret: nav.arret, trace: nav.trace })[Number(rang) || 0];
  if (!b) {
    return { ok: false, texte: rang ? 'Je n\'ai pas d\'autre borne à proposer.'
      : `Aucune borne ${NOMS_RESEAUX[reseau]} ni partenaire près de l'arrêt prévu sans un détour de plus de ${DETOUR_MAX_KM} kilomètres.` };
  }
  return { ok: true, texte: phraseProposition(b, reseau), borne: `${b.lat},${b.lon}`, nom: `${NOMS_RESEAUX[b.reseau]} ${b.nom}` };
}

// Pas de navigation : borne autour de la voiture. Sa position n'est pas dans la télémétrie diffusée (champ facturé à
// chaque signal) : on la demande une seule fois, ici. Pas de réveil : si la voiture dort, Teslemetry répond 408.
async function proposerAutour(env, vin, reseau, rang) {
  const position = positionVehicule(await teslemetry(env, `/api/1/vehicles/${vin}/vehicle_data?endpoints=location_data`));
  if (!position) return { ok: false, texte: 'Pas de navigation en cours, et la Tesla ne donne pas sa position.' };
  const b = bornesAutour(await lireBornes(), { reseau, position })[Number(rang) || 0];
  if (!b) {
    return { ok: false, texte: rang ? 'Je n\'ai pas d\'autre borne à proposer.'
      : `Aucune borne ${NOMS_RESEAUX[reseau]} ni partenaire à moins de ${RAYON_KM} kilomètres.` };
  }
  return { ok: true, texte: phraseAutour(b, reseau), borne: `${b.lat},${b.lon}`, nom: `${NOMS_RESEAUX[b.reseau]} ${b.nom}` };
}

async function envoyer(env, { borne }) {
  const [lat, lon] = String(borne || '').split(',').map(Number);
  const b = Number.isFinite(lat) && Number.isFinite(lon) ? borneConnue(await lireBornes(), { lat, lon }) : null;
  if (!b) return { ok: false, texte: 'Cette borne n\'est pas dans la liste : rien n\'a été envoyé.' };
  const vin = await premierVin(env);
  const r = await teslemetry(env, `/api/1/vehicles/${vin}/command/navigation_gps_request`, {
    method: 'POST',
    body: JSON.stringify({ lat: b.lat, lon: b.lon, order: ORDRE }),
  });
  if (r.response?.result === false) return { ok: false, texte: `La Tesla a refusé : ${r.response.reason || 'raison inconnue'}.` };
  return { ok: true, texte: `C'est envoyé : la Tesla part vers ${NOMS_RESEAUX[b.reseau]} ${b.nom}.` };
}

export default {
  async fetch(requete, env) {
    const json = (donnees, status = 200) =>
      new Response(JSON.stringify(donnees), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
    if (!env.MOT_DE_PASSE || !env.TESLEMETRY_JETON) {
      return json({ ok: false, texte: 'Worker incomplet : ajouter les secrets MOT_DE_PASSE et TESLEMETRY_JETON.' }, 500);
    }
    if (requete.method !== 'POST') return json({ ok: false, texte: 'Méthode refusée' }, 405);
    if (!(await motDePasseValide(requete, env.MOT_DE_PASSE))) return json({ ok: false, texte: 'Mot de passe refusé.' }, 401);
    const corps = await requete.json().catch(() => ({}));
    try {
      const chemin = new URL(requete.url).pathname;
      if (chemin === '/proposer') return json(await proposer(env, corps));
      if (chemin === '/envoyer') return json(await envoyer(env, corps));
      return json({ ok: false, texte: 'Adresse inconnue' }, 404);
    } catch (e) {
      return json({ ok: false, texte: `Erreur : ${e.message}.` }); // lu par Siri
    }
  },
};

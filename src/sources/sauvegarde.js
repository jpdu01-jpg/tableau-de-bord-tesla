// Sauvegarde en ligne de l'historique des trajets, via le Worker Cloudflare « sauvegarde-trajets »
// (relais/sauvegarde-worker.js, installation : relais/LISEZMOI.md). L'adresse et le mot de passe sont saisis dans les
// Réglages et restent uniquement dans le stockage local du navigateur. Le mot de passe voyage dans un en-tête,
// jamais dans l'adresse.
import { aEnvoyer, marquerEnvoyes, paquets } from '../lib/sauvegarde.js';

const CLE_ADRESSE = 'sauvegarde-adresse';
const CLE_MDP = 'sauvegarde-mdp';
const CLE_ENVOYES = 'sauvegarde-envoyes'; // { debut: fin } des trajets déjà sauvegardés
const CLE_DERNIERE = 'sauvegarde-derniere'; // heure (ms) de la dernière sauvegarde réussie

export const lireAdresseSauvegarde = () => localStorage.getItem(CLE_ADRESSE) || '';
export const sauvegardeConfiguree = () => Boolean(lireAdresseSauvegarde() && localStorage.getItem(CLE_MDP));
export const derniereSauvegarde = () => Number(localStorage.getItem(CLE_DERNIERE)) || 0;

export function enregistrerAdresseSauvegarde(adresse) {
  if (adresse) localStorage.setItem(CLE_ADRESSE, adresse.trim().replace(/\/+$/, ''));
  else localStorage.removeItem(CLE_ADRESSE);
  localStorage.removeItem(CLE_ENVOYES); // autre sauvegarde : tout renvoyer
}
export function enregistrerMotDePasseSauvegarde(mdp) {
  if (mdp) localStorage.setItem(CLE_MDP, mdp);
  else localStorage.removeItem(CLE_MDP);
}

async function appeler(methode, corps) {
  let rep;
  try {
    rep = await fetch(`${lireAdresseSauvegarde()}/trajets`, {
      method: methode,
      headers: { Authorization: `Bearer ${localStorage.getItem(CLE_MDP)}`, 'Content-Type': 'application/json' },
      body: corps == null ? undefined : JSON.stringify(corps),
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('Sauvegarde injoignable : pas de réseau, ou adresse du Worker incorrecte');
  }
  const reponse = await rep.json().catch(() => ({}));
  if (rep.status === 401) throw new Error('Mot de passe de sauvegarde refusé');
  if (rep.status === 403) throw new Error('Cette page n\'est pas autorisée (ORIGINES dans relais/sauvegarde-worker.js)');
  if (!rep.ok) throw new Error(reponse.erreur || `Le Worker a répondu ${rep.status}`);
  return reponse;
}

let enCours = null;
/** Envoie les trajets nouveaux ou modifiés. Renvoie le nombre de trajets envoyés. Un seul envoi à la fois. */
export async function envoyerHistorique(liste) {
  if (enCours) return enCours;
  enCours = envoyer(liste);
  try {
    return await enCours;
  } finally {
    enCours = null;
  }
}

async function envoyer(liste) {
  let envoyes = JSON.parse(localStorage.getItem(CLE_ENVOYES) || '{}');
  const lot = aEnvoyer(liste, envoyes);
  for (const paquet of paquets(lot)) {
    await appeler('PUT', paquet);
    envoyes = marquerEnvoyes(envoyes, paquet);
    localStorage.setItem(CLE_ENVOYES, JSON.stringify(envoyes)); // un paquet réussi n'est pas renvoyé
  }
  localStorage.setItem(CLE_DERNIERE, String(Date.now()));
  return lot.length;
}

/** Note des trajets comme déjà présents dans la sauvegarde (ceux qu'on vient d'y lire). */
export function noterDejaSauvegardes(lot) {
  const envoyes = JSON.parse(localStorage.getItem(CLE_ENVOYES) || '{}');
  localStorage.setItem(CLE_ENVOYES, JSON.stringify(marquerEnvoyes(envoyes, lot)));
}

/** Tous les trajets de la sauvegarde. */
export const recupererHistorique = () => appeler('GET');

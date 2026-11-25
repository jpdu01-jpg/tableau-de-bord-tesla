// Sauvegarde en ligne de l'historique des trajets (Worker Cloudflare, voir relais/sauvegarde-worker.js).
// Fonctions pures, testées dans tests/sauvegarde.test.js.
//
// On n'envoie que ce qui a changé : pour chaque trajet déjà sauvegardé, on retient l'heure de fin envoyée
// (« envoyes » : { debut: fin }). Un trajet en cours dont la fin a avancé sera renvoyé.
import { TAILLE_MAX } from './historique.js';

export const TAILLE_PAQUET = 200; // trajets par envoi (quelques dizaines de Ko)

/** Trajets à envoyer : nouveaux, ou modifiés depuis le dernier envoi réussi. */
export const aEnvoyer = (liste, envoyes = {}) => liste.filter((r) => envoyes[r.debut] !== r.fin);

/** Mémorise les trajets envoyés avec succès. Renvoie un nouvel objet. */
export function marquerEnvoyes(envoyes, lot) {
  const copie = { ...envoyes };
  for (const r of lot) copie[r.debut] = r.fin;
  return copie;
}

/** Découpe une liste en paquets de taille donnée. */
export function paquets(liste, taille = TAILLE_PAQUET) {
  const resultat = [];
  for (let i = 0; i < liste.length; i += taille) resultat.push(liste.slice(i, i + taille));
  return resultat;
}

/**
 * Réunit l'historique du téléphone et celui de la sauvegarde. Pour un même trajet (même départ), la version la plus
 * avancée (fin la plus tardive) l'emporte ; à égalité, celle du téléphone. Plus récent en tête, taille limitée.
 */
export function fusionnerHistoriques(local, distant) {
  const parDebut = new Map();
  for (const r of [...local, ...distant]) {
    if (!r || !Number.isFinite(r.debut) || !Number.isFinite(r.fin)) continue;
    const deja = parDebut.get(r.debut);
    if (!deja || r.fin > deja.fin) parDebut.set(r.debut, r);
  }
  return [...parDebut.values()].sort((a, b) => b.debut - a.debut).slice(0, TAILLE_MAX);
}

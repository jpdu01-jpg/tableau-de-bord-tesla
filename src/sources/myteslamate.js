// Connexion à la Tesla via MyTeslaMate (plan API, facturé à l'usage).
// La clé API est saisie dans les Réglages et reste uniquement dans le stockage local du navigateur.
//
// Pour l'instant : TEST DE CONNEXION uniquement (pas encore de flux pendant la conduite) :
//   1. liste des véhicules : GET /api/1/vehicles (≈ 1/300 de crédit), ne réveille pas la voiture ;
//   2. si la voiture est éveillée : écoute du flux temps réel pendant 20 secondes, au format brut
//      (tous les champs configurés sur la voiture), pour vérifier les données et mesurer le coût réel.
import { messageAbonnementBrut, interpreterMessageBrut } from '../lib/teslaStream.js';

const API = 'https://api.myteslamate.com/api/1';
const STREAMING = 'wss://streaming.myteslamate.com/streaming/';
const CLE = 'myteslamate-jeton';
const DUREE_TEST_MS = 20000;

export const lireJetonMTM = () => localStorage.getItem(CLE) || '';
export const enregistrerJetonMTM = (jeton) => (jeton ? localStorage.setItem(CLE, jeton.trim()) : localStorage.removeItem(CLE));

/** Liste des véhicules du compte : [{ nom, vin, etat }]. Lève une erreur lisible en cas de problème. */
export async function listerVehicules(jeton = lireJetonMTM()) {
  const rep = await fetch(`${API}/vehicles`, {
    headers: { Authorization: `Bearer ${jeton}` },
    signal: AbortSignal.timeout(15000),
  });
  if (rep.status === 401) throw new Error('Clé MyTeslaMate refusée : vérifie-la sur app.myteslamate.com/fleet');
  if (!rep.ok) throw new Error(`MyTeslaMate a répondu ${rep.status}`);
  const json = await rep.json();
  return (json.response || []).map((v) => ({ nom: v.display_name || 'Tesla', vin: v.vin, etat: v.state }));
}

/**
 * Écoute le flux temps réel (format brut) pendant 20 s. Renvoie un résumé :
 * { messages, mises, signaux, erreurs: [...], champs: { NomDuChamp: dernière valeur }, autres: [...], ferme: raison }
 */
export function testerFlux(vin, jeton = lireJetonMTM()) {
  return new Promise((resolve) => {
    const resume = { messages: 0, mises: 0, signaux: 0, erreurs: [], champs: {}, autres: [], ferme: null };
    let ws;
    try {
      ws = new WebSocket(STREAMING);
    } catch (e) {
      resume.ferme = `ouverture impossible : ${e.message}`;
      resolve(resume);
      return;
    }
    const fin = setTimeout(() => ws.close(), DUREE_TEST_MS);
    ws.onopen = () => ws.send(messageAbonnementBrut(jeton, vin));
    ws.onmessage = (ev) => {
      resume.messages++;
      const m = interpreterMessageBrut(ev.data, vin);
      if (m.type === 'donnees') {
        resume.mises++;
        resume.signaux += m.signaux;
        Object.assign(resume.champs, m.champs);
      } else if (m.type === 'erreur') {
        resume.erreurs.push(`${m.erreur}${m.detail ? ` (${m.detail})` : ''}`);
      } else if (m.msgType && !resume.autres.includes(m.msgType)) {
        resume.autres.push(m.msgType);
      }
    };
    ws.onerror = () => resume.erreurs.push('erreur de connexion WebSocket');
    ws.onclose = (ev) => {
      clearTimeout(fin);
      resume.ferme = ev.code === 1000 || ev.code === 1005 ? 'fin du test' : `fermé par le serveur (code ${ev.code})`;
      resolve(resume);
    };
  });
}

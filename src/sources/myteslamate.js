// Connexion à la Tesla via MyTeslaMate (plan API, facturé à l'usage).
// La clé API est saisie dans les Réglages et reste uniquement dans le stockage local du navigateur.
//
// 1. TEST DE CONNEXION (Réglages) : liste des véhicules (≈ 1/300 de crédit, ne réveille pas la voiture),
//    puis écoute du flux temps réel pendant 20 secondes si la voiture est éveillée.
// 2. FLUX PENDANT LA CONDUITE (classe TeslaMyTeslaMate) : écoute au format brut des champs déjà configurés
//    sur la voiture (docs/telemetrie/config-telemetrie.json). On n'ajoute aucun champ : le coût ne change pas.
import { messageAbonnementBrut, interpreterMessageBrut, donneesTesla, devinerUniteRegulateur } from '../lib/teslaStream.js';
import { navigationDepuisChamps } from '../lib/navigation.js';

const API = 'https://api.myteslamate.com/api/1';
const STREAMING = 'wss://streaming.myteslamate.com/streaming/';
const CLE = 'myteslamate-jeton';
const DUREE_TEST_MS = 20000;

// ⚠️ Le serveur de flux MyTeslaMate n'envoie les données d'une voiture qu'à UN SEUL abonné : le dernier connecté
// (voir github.com/MyTeslaMate/websocket, index.js : tags[VIN] = connexion). Le TeslaMate hébergé du propriétaire
// est déjà abonné : en s'abonnant, l'app lui volerait le flux (et pourrait lui envoyer le format brut, qu'il ne
// comprend pas), puis le perdrait à son tour. Coupé tant que MyTeslaMate n'accepte pas plusieurs abonnés.
export const FLUX_PARTAGE_DISPONIBLE = false;

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

/** Configuration télémétrie appliquée à la voiture (réponse brute de l'API). Ne réveille pas la voiture. */
export async function lireConfigTelemetrie(vin, jeton = lireJetonMTM()) {
  const rep = await fetch(`${API}/vehicles/${vin}/fleet_telemetry_config`, {
    headers: { Authorization: `Bearer ${jeton}` },
    signal: AbortSignal.timeout(15000),
  });
  if (!rep.ok) throw new Error(`MyTeslaMate a répondu ${rep.status}`);
  return rep.json();
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

/**
 * Flux Tesla pendant la conduite. Même interface que les autres sources Tesla (voir tesla.js) :
 * start(onData) → onData({ powerKw?, cruiseKmh?, batteryPct?, destinationNom?, trace?, minutesArrivee?, … , t }).
 * Ne réveille jamais la voiture : en roulant, elle est forcément éveillée. Reconnexion automatique en cas de coupure.
 */
export class TeslaMyTeslaMate {
  etat = 'connexion';
  vitesseGpsKmh = null; // fournie par l'application, sert à deviner l'unité du régulateur
  #ws = null;
  #arret = false;
  #memoire = {};
  #unite = localStorage.getItem('tesla-unite-regulateur') || 'kmh';
  // Diagnostic affiché en touchant la pastille « Tesla » : ce qui s'est passé sur la connexion.
  diag = { vin: null, connexions: 0, ouverte: false, messages: 0, mises: 0, signaux: 0, dernierMessage: 0, derniereMise: 0, journal: [], champs: {} };

  #noter(texte) {
    const heure = new Date().toLocaleTimeString('fr-FR');
    this.diag.journal = [...this.diag.journal, `${heure} ${texte}`].slice(-10);
  }

  async start(onData) {
    this.#arret = false;
    let vin;
    try {
      vin = (await listerVehicules())[0]?.vin;
      if (!vin) throw new Error('aucun véhicule');
    } catch (e) {
      this.etat = 'erreur';
      this.#noter(`liste des véhicules impossible : ${e.message}`);
      if (!this.#arret) this.#relance = setTimeout(() => this.start(onData), 30000);
      return;
    }
    this.diag.vin = `…${vin.slice(-4)}`; // seulement la fin du VIN à l'écran
    this.#noter('véhicule trouvé');
    this.#connecter(vin, onData, 0);
  }

  #relance = null;

  #connecter(vin, onData, essais) {
    if (this.#arret) return;
    this.etat = 'connexion';
    this.diag.connexions++;
    const ws = (this.#ws = new WebSocket(STREAMING));
    ws.onopen = () => {
      this.diag.ouverte = true;
      this.#noter('connexion ouverte, abonnement envoyé');
      ws.send(messageAbonnementBrut(lireJetonMTM(), vin));
    };
    ws.onmessage = (ev) => {
      const m = interpreterMessageBrut(ev.data, vin);
      this.diag.messages++;
      this.diag.dernierMessage = Date.now();
      if (m.type === 'erreur') {
        this.etat = 'erreur';
        this.#noter(`erreur du serveur : ${m.erreur}`);
      }
      const type = m.msgType?.replace(vin, 'VIN'); // le VIN complet n'est jamais affiché
      if (m.type === 'autre' && type && type !== 'control:hello' && !this.diag.journal.some((l) => l.endsWith(type))) {
        this.#noter(`message ${type}`); // ex. control:hello:VIN = abonnement accepté
      }
      if (m.type !== 'donnees') return;
      if (!this.diag.mises) this.#noter('premières données reçues');
      this.diag.mises++;
      this.diag.signaux += m.signaux;
      for (const [nom, valeur] of Object.entries(m.champs)) {
        // nombre de réceptions et dernière valeur de chaque champ (positions et tracé non affichés)
        const c = (this.diag.champs[nom] ??= { n: 0, valeur: null, premier: Date.now() });
        c.n++;
        c.intervalleS = Math.round((Date.now() - c.premier) / 1000 / (c.n - 1)); // intervalle moyen entre deux réceptions
        c.valeur = typeof valeur === 'number' ? Math.round(valeur * 10) / 10 : valeur == null ? '∅' : typeof valeur === 'string' && valeur.length <= 12 ? valeur : '…';
      }
      this.diag.derniereMise = Date.now();
      this.etat = 'ok';
      essais = 0;
      if ('CruiseSetSpeed' in m.champs) this.#verifierUnite(m.champs.CruiseSetSpeed);
      onData({
        ...donneesTesla(m.champs, this.#memoire, this.#unite),
        ...navigationDepuisChamps(m.champs),
        t: Date.now(), // horloge du téléphone, comme le GPS
      });
    };
    ws.onclose = (ev) => {
      this.diag.ouverte = false;
      this.#noter(`connexion fermée (code ${ev.code}${ev.reason ? `, ${ev.reason}` : ''})`);
      if (this.#arret) return;
      this.etat = 'erreur';
      const delai = Math.min(60000, 2000 * 2 ** essais); // 2 s, 4 s, 8 s… jusqu'à 1 min
      this.#relance = setTimeout(() => this.#connecter(vin, onData, essais + 1), delai);
    };
  }

  // L'unité du régulateur (km/h ou mph) est devinée une fois, puis mémorisée.
  #verifierUnite(consigne) {
    if (localStorage.getItem('tesla-unite-regulateur')) return;
    const u = devinerUniteRegulateur(consigne, this.vitesseGpsKmh);
    if (u) {
      this.#unite = u;
      localStorage.setItem('tesla-unite-regulateur', u);
    }
  }

  stop() {
    this.#arret = true;
    clearTimeout(this.#relance);
    this.#ws?.close();
  }
}

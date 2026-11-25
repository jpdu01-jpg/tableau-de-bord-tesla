// Connexion à la Tesla via Teslemetry (teslemetry.com). Le jeton d'accès est saisi dans les Réglages et reste
// uniquement dans le stockage local du navigateur.
//
// Avantage sur MyTeslaMate : Teslemetry a sa propre configuration de télémétrie sur la voiture et accepte plusieurs
// abonnés : l'app reçoit le flux sans gêner TeslaMate. Le streaming est gratuit (dans l'allocation de l'abonnement).
// Les champs se choisissent dans la console Teslemetry (liste : CHAMPS_TESLEMETRY dans src/lib/teslemetry.js).
import { interpreterTeslemetry } from '../lib/teslemetry.js';
import { donneesTesla, devinerUniteRegulateur } from '../lib/teslaStream.js';
import { navigationDepuisChamps } from '../lib/navigation.js';

const CLE = 'teslemetry-jeton';
const CLE_RELAIS = 'teslemetry-relais';

// Teslemetry n'autorise pas les pages web : on passe par un relais (Cloudflare Worker, voir relais/LISEZMOI.md)
// dont l'adresse est saisie dans les Réglages. Sans relais, appel direct (bloqué par le navigateur à ce jour).
export const lireRelaisTeslemetry = () => localStorage.getItem(CLE_RELAIS) || '';
export const enregistrerRelaisTeslemetry = (adresse) =>
  adresse ? localStorage.setItem(CLE_RELAIS, adresse.trim().replace(/\/+$/, '')) : localStorage.removeItem(CLE_RELAIS);
const api = () => lireRelaisTeslemetry() || 'https://api.teslemetry.com';
const DUREE_TEST_MS = 15000;

export const lireJetonTeslemetry = () => localStorage.getItem(CLE) || '';
export const enregistrerJetonTeslemetry = (jeton) => (jeton ? localStorage.setItem(CLE, jeton.trim()) : localStorage.removeItem(CLE));

// Le jeton passe dans l'adresse (« ?token= ») : c'est la méthode prévue par Teslemetry pour les navigateurs,
// le flux EventSource ne pouvant pas envoyer d'en-tête d'autorisation.
const url = (chemin, params = {}) =>
  `${api()}${chemin}?${new URLSearchParams({ ...params, token: lireJetonTeslemetry() })}`;

async function lireJson(chemin) {
  let rep;
  try {
    rep = await fetch(url(chemin), { signal: AbortSignal.timeout(15000) });
  } catch {
    // Le navigateur ne dit pas pourquoi : pas de réseau, jeton refusé (réponse sans autorisation pour les pages web),
    // ou Teslemetry qui n'accepte pas les pages web.
    throw new Error(lireRelaisTeslemetry() ? 'Relais injoignable : vérifie son adresse et que le Worker est déployé' : 'Teslemetry bloque les pages web : enregistre l\'adresse du relais Cloudflare (voir relais/LISEZMOI.md)');
  }
  if (rep.status === 401) throw new Error('Jeton Teslemetry refusé : vérifie-le dans la console Teslemetry');
  if (rep.status === 403) throw new Error('Relais : cette page n\'est pas autorisée (voir ORIGINES dans relais/teslemetry-worker.js)');
  if (!rep.ok) throw new Error(`Teslemetry a répondu ${rep.status}`);
  return rep.json();
}

/** Véhicules du compte : [{ vin, nom, plan }] (ne réveille pas la voiture, gratuit). */
export async function vehiculesTeslemetry() {
  const m = await lireJson('/api/metadata');
  return Object.entries(m.vehicles || {}).map(([vin, v]) => ({ vin, nom: v.name || 'Tesla', plan: v.plan ?? null }));
}

/** Configuration de streaming Teslemetry de la voiture (gratuit). */
export const configTeslemetry = (vin) => lireJson(`/api/config/${vin}`);

/** Ouvre le flux. Renvoie la connexion EventSource (à fermer avec .close()). */
function ouvrirFlux(vin, { onData, onEtat, onOuvert, onErreur }) {
  const es = new EventSource(url(`/sse/${vin}`, { topics: 'data,state' }));
  es.onopen = () => onOuvert?.();
  es.onerror = () => onErreur?.(es.readyState); // EventSource se reconnecte tout seul
  const recevoir = (ev) => {
    const m = interpreterTeslemetry(ev.data, vin, Date.now());
    if (m.type === 'donnees') onData(m);
    else if (m.type === 'etat') onEtat?.(m.etat);
  };
  es.addEventListener('data', recevoir);
  es.addEventListener('state', recevoir);
  es.onmessage = recevoir; // événements sans nom, par sécurité
  return es;
}

/** Test : écoute le flux 15 s. Renvoie { ouvert, erreurs, mises, champs: { nom: valeur }, etat }. */
export function testerFluxTeslemetry(vin) {
  return new Promise((resolve) => {
    const r = { ouvert: false, erreurs: 0, mises: 0, champs: {}, etat: null };
    const es = ouvrirFlux(vin, {
      onOuvert: () => (r.ouvert = true),
      onErreur: () => r.erreurs++,
      onEtat: (e) => (r.etat = e),
      onData: (m) => {
        r.mises++;
        Object.assign(r.champs, m.champs);
      },
    });
    setTimeout(() => {
      es.close();
      resolve(r);
    }, DUREE_TEST_MS);
  });
}

/**
 * Flux Tesla pendant la conduite. Même interface que les autres sources Tesla (voir tesla.js) :
 * start(onData) → onData({ powerKw?, cruiseKmh?, batteryPct?, destinationNom?, trace?, minutesArrivee?, … , t }).
 */
export class TeslaTeslemetry {
  etat = 'connexion';
  vitesseGpsKmh = null; // fournie par l'application, sert à deviner l'unité du régulateur
  #es = null;
  #memoire = {};
  #unite = localStorage.getItem('tesla-unite-regulateur') || 'mph'; // Teslemetry documente CruiseSetSpeed en mph
  #relance = null;
  #arret = false;
  // Diagnostic affiché en touchant la pastille « Tesla » (même forme que la source MyTeslaMate).
  diag = { source: 'Teslemetry', vin: null, connexions: 0, ouverte: false, messages: 0, mises: 0, signaux: 0, dernierMessage: 0, derniereMise: 0, journal: [], champs: {} };

  #noter(texte) {
    const heure = new Date().toLocaleTimeString('fr-FR');
    this.diag.journal = [...this.diag.journal, `${heure} ${texte}`].slice(-10);
  }

  async start(onData) {
    this.#arret = false;
    let vin;
    try {
      vin = (await vehiculesTeslemetry())[0]?.vin;
      if (!vin) throw new Error('aucun véhicule');
    } catch (e) {
      this.etat = 'erreur';
      this.#noter(`liste des véhicules impossible : ${e.message}`);
      if (!this.#arret) this.#relance = setTimeout(() => this.start(onData), 30000);
      return;
    }
    if (this.#arret) return;
    this.diag.vin = `…${vin.slice(-4)}`; // seulement la fin du VIN à l'écran
    this.#ouvrir(vin, onData);
  }

  #ouvrir(vin, onData) {
    if (this.#arret) return;
    this.diag.connexions++;
    this.#es = ouvrirFlux(vin, {
      onOuvert: () => {
        this.diag.ouverte = true;
        this.#noter('flux ouvert');
      },
      onErreur: (readyState) => {
        this.diag.ouverte = false;
        this.etat = 'erreur';
        if (readyState === EventSource.CLOSED) {
          // fermé pour de bon (jeton refusé, accès bloqué…) : nouvel essai dans 30 s
          this.#noter('flux fermé, nouvel essai dans 30 s');
          this.#relance = setTimeout(() => this.#ouvrir(vin, onData), 30000);
        } else {
          this.#noter('flux interrompu, reconnexion automatique');
        }
      },
      onEtat: (e) => {
        this.#noter(`voiture : ${e}`);
        onData({ etatVoiture: e, t: Date.now() }); // voiture endormie = garée : fin du trajet
      },
      onData: (m) => this.#recevoir(m, onData),
    });
  }

  #recevoir(m, onData) {
    this.diag.messages++;
    this.diag.mises++;
    this.diag.signaux += m.signaux;
    this.diag.dernierMessage = this.diag.derniereMise = Date.now();
    if (!this.diag.journal.some((l) => l.endsWith('premières données reçues'))) this.#noter('premières données reçues');
    for (const [nom, valeur] of Object.entries(m.champs)) {
      const c = (this.diag.champs[nom] ??= { n: 0, valeur: null, premier: Date.now() });
      c.n++;
      c.intervalleS = Math.round((Date.now() - c.premier) / 1000 / (c.n - 1));
      c.valeur = typeof valeur === 'number' ? Math.round(valeur * 10) / 10 : valeur == null ? '∅' : typeof valeur === 'string' && valeur.length <= 12 ? valeur : '…';
    }
    this.etat = 'ok';
    if ('CruiseSetSpeed' in m.champs && !localStorage.getItem('tesla-unite-regulateur')) {
      const u = devinerUniteRegulateur(m.champs.CruiseSetSpeed, this.vitesseGpsKmh);
      if (u) localStorage.setItem('tesla-unite-regulateur', (this.#unite = u));
    }
    onData({
      ...donneesTesla(m.champs, this.#memoire, this.#unite),
      ...navigationDepuisChamps(m.champs),
      t: Date.now(), // horloge du téléphone, comme le GPS
    });
  }

  stop() {
    this.#arret = true;
    clearTimeout(this.#relance);
    this.#es?.close();
  }
}

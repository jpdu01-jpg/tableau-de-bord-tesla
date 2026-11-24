// Boîtier Teslogic V2 branché sur la voiture : trames CAN reçues en Bluetooth (gratuit, plusieurs fois par seconde).
// Fournit puissance, vitesse, batterie, régulateur et limitation de vitesse (décodage : src/lib/can.js).
//
// ⚠️ Safari sur iPhone ne permet pas le Bluetooth aux pages web : ouvrir l'app dans le navigateur Bluefy.
// La connexion doit être lancée par un toucher de l'utilisateur (règle des navigateurs) : bouton « Démarrer le
// trajet » ou pastille « Voiture ». Le boîtier émet tout seul : il suffit d'écouter.
import { decoderPaquet, donneesTeslogic } from '../lib/can.js';

const SERVICE = '0000ff01-0000-1000-8000-00805f9b34fb';
const CARACTERISTIQUE = '0000ff02-0000-1000-8000-00805f9b34fb';

export const bluetoothDisponible = () => Boolean(navigator.bluetooth);

export class Teslogic {
  etat = 'deconnecte'; // 'deconnecte' | 'connexion' | 'ok' | 'erreur'
  diag = { paquets: 0, dernier: 0, journal: [], brut: {} };
  #appareil = null;
  #onData = null;
  #arret = false;
  #relance = null;
  #surValeur = (ev) => this.#recevoir(ev.target.value);

  #noter(texte) {
    const heure = new Date().toLocaleTimeString('fr-FR');
    this.diag.journal = [...this.diag.journal, `${heure} ${texte}`].slice(-6);
  }

  /** Choix du boîtier (fenêtre du navigateur) puis écoute. À appeler directement depuis un toucher. */
  async connecter(onData) {
    this.#onData = onData;
    this.#arret = false;
    if (!bluetoothDisponible()) throw new Error('Bluetooth indisponible dans ce navigateur : ouvre l\'app dans Bluefy.');
    this.etat = 'connexion';
    try {
      this.#appareil = await navigator.bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: [SERVICE] });
    } catch (e) {
      this.etat = 'deconnecte'; // fenêtre fermée sans choisir
      throw e;
    }
    this.#appareil.addEventListener('gattserverdisconnected', () => this.#perdu());
    await this.#ecouter();
  }

  async #ecouter() {
    try {
      this.etat = 'connexion';
      const serveur = await this.#appareil.gatt.connect();
      const service = await serveur.getPrimaryService(SERVICE);
      const carac = await service.getCharacteristic(CARACTERISTIQUE);
      carac.removeEventListener('characteristicvaluechanged', this.#surValeur); // pas de doublon après reconnexion
      carac.addEventListener('characteristicvaluechanged', this.#surValeur);
      await carac.startNotifications();
      this.#noter(`connecté à ${this.#appareil.name || 'Teslogic'}`);
    } catch (e) {
      this.etat = 'erreur';
      this.#noter(`connexion impossible : ${e.message}`);
      this.#relancer();
    }
  }

  #recevoir(vue) {
    const paquet = new Uint8Array(vue.buffer, vue.byteOffset, vue.byteLength);
    const brut = decoderPaquet(paquet);
    Object.assign(this.diag.brut, brut);
    this.diag.paquets++;
    this.diag.dernier = Date.now();
    this.etat = 'ok';
    const d = donneesTeslogic(brut);
    if (Object.keys(d).length) this.#onData?.({ ...d, t: Date.now() });
  }

  #perdu() {
    if (this.#arret) return;
    this.etat = 'erreur';
    this.#noter('connexion perdue');
    this.#relancer();
  }

  // Le boîtier déjà choisi peut être reconnecté sans nouveau toucher.
  #relancer() {
    if (this.#arret || !this.#appareil) return;
    clearTimeout(this.#relance);
    this.#relance = setTimeout(() => this.#ecouter(), 3000);
  }

  stop() {
    this.#arret = true;
    clearTimeout(this.#relance);
    this.#appareil?.gatt?.disconnect();
    this.etat = 'deconnecte';
  }
}

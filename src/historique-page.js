// Page « Historique des trajets » (historique.html) : affiche tous les trajets de la sauvegarde en ligne, réunis avec
// ceux de ce navigateur. Affichage uniquement : les calculs viennent de src/lib/.
import { detailsTrajet, totauxHistorique, historiqueCsv, texteDate, texteHeure } from './lib/historique.js';
import { fusionnerHistoriques } from './lib/sauvegarde.js';
import { sauvegardeConfiguree, enregistrerAdresseSauvegarde, enregistrerMotDePasseSauvegarde, recupererHistorique, noterDejaSauvegardes } from './sources/sauvegarde.js';

const $ = (id) => document.getElementById(id);
const nombre = (v, d = 0) => (v == null || !Number.isFinite(v) ? '–' : v.toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d }));
const local = () => JSON.parse(localStorage.getItem('historique') || '[]'); // trajets de ce navigateur (pas la démo)
let liste = [];

function afficher() {
  const t = totauxHistorique(liste);
  $('totaux').innerHTML = '';
  for (const [valeur, legende] of [
    [nombre(t.trajets), 'trajets'], [`${nombre(t.distanceKm)} km`, 'distance'], [`${nombre(t.energieKwh, 1)} kWh`, 'énergie'],
    [`${nombre(t.kwh100, 1)}`, 'kWh/100 km moyen'], [`${nombre(t.dureeMin / 60, 1)} h`, 'au volant'],
  ]) {
    const d = document.createElement('div');
    d.append(Object.assign(document.createElement('b'), { textContent: valeur }), Object.assign(document.createElement('span'), { textContent: legende }));
    $('totaux').append(d);
  }

  const corps = $('lignes');
  corps.replaceChildren();
  if (!liste.length) {
    const td = Object.assign(document.createElement('td'), { className: 'vide', colSpan: 13, textContent: 'Aucun trajet pour l\'instant.' });
    corps.append(document.createElement('tr')).append(td);
  }
  for (const r of liste) {
    const d = detailsTrajet(r);
    const batterie = r.batterieDebutPct != null ? `${r.batterieDebutPct} → ${r.batterieFinPct} % (${nombre(d.batterieUtiliseePct)})` : '–';
    const temp = d.temperatureMoy == null ? '–'
      : `${nombre(d.temperatureMoy, 1)} °C` + (r.tempMin != null && r.tempMax - r.tempMin >= 1 ? ` (${nombre(r.tempMin)} à ${nombre(r.tempMax)})` : '');
    const face = d.ventFaceMoyKmh == null ? '–' : `${d.ventFaceMoyKmh >= 0 ? 'face' : 'arrière'} ${nombre(Math.abs(d.ventFaceMoyKmh))} km/h`;
    const cellules = [
      texteDate(r.debut), texteHeure(r.debut), texteHeure(r.fin), r.destination || '–', `${nombre(r.distanceKm, 1)} km`,
      `${nombre(d.dureeMin)} min`, `${nombre(d.vitesseMoyKmh)} km/h`, `${nombre(r.energieKwh, 1)} kWh`, nombre(d.kwh100, 1),
      batterie, temp, d.ventMoyKmh == null ? '–' : `${nombre(d.ventMoyKmh)} km/h`, face,
    ];
    const tr = document.createElement('tr');
    cellules.forEach((texte, i) => tr.append(Object.assign(document.createElement('td'), { textContent: texte, className: i === 3 ? 'texte' : '', title: i === 3 ? texte : '' })));
    corps.append(tr);
  }
  $('btn-csv').disabled = !liste.length;
}

function source(texte, erreur = false) {
  $('source').textContent = texte;
  $('source').classList.toggle('erreur', erreur);
}

async function charger() {
  $('connexion').hidden = sauvegardeConfiguree();
  if (!sauvegardeConfiguree()) {
    liste = local();
    source(`${liste.length} trajet${liste.length > 1 ? 's' : ''} de ce navigateur · sauvegarde en ligne non configurée ici`);
    return afficher();
  }
  source('Lecture de la sauvegarde en ligne…');
  try {
    const distant = await recupererHistorique();
    noterDejaSauvegardes(distant);
    liste = fusionnerHistoriques(local(), distant);
    source(`Sauvegarde en ligne · ${liste.length} trajet${liste.length > 1 ? 's' : ''} · lue à ${texteHeure(Date.now())}`);
  } catch (e) {
    liste = local();
    $('connexion').hidden = false; // permet de corriger l'adresse ou le mot de passe
    source(`${e.message} — affichage des trajets de ce navigateur seulement`, true);
  }
  afficher();
}

// Fichier CSV (Excel / Numbers). Sur iPhone : feuille de partage, sinon téléchargement.
async function exporter() {
  const nom = `trajets-${new Date().toISOString().slice(0, 10)}.csv`;
  const fichier = new File(['﻿' + historiqueCsv(liste)], nom, { type: 'text/csv' }); // ﻿ : accents lus par Excel
  if (navigator.canShare?.({ files: [fichier] })) {
    try {
      await navigator.share({ files: [fichier], title: 'Historique des trajets' });
    } catch { /* partage annulé */ }
    return;
  }
  const lien = Object.assign(document.createElement('a'), { href: URL.createObjectURL(fichier), download: nom });
  lien.click();
  setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
}

$('connexion').onsubmit = (ev) => {
  ev.preventDefault();
  enregistrerAdresseSauvegarde($('adresse').value);
  enregistrerMotDePasseSauvegarde($('mdp').value);
  $('mdp').value = '';
  charger();
};
$('btn-actualiser').onclick = charger;
$('btn-csv').onclick = exporter;
charger();

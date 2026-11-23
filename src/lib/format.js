// Mise en forme des valeurs affichées. Fonctions pures, testées dans tests/format.test.js.

/**
 * Consommation instantanée sur 4 caractères au plus, pour que le pavé garde toujours la même largeur :
 *   moins de 10 en valeur absolue → une décimale : « 9,6 », « -5,7 »
 *   à partir de 10 → entier : « 12 », « -12 », « 135 »
 *   au-delà de -99 / 999 → bornée (pics très brefs, sans intérêt à lire)
 * Le résultat est complété par des espaces à gauche pour faire exactement 4 caractères.
 */
export function texteConsoInstantanee(v) {
  if (v == null || !Number.isFinite(v)) return '  --';
  const borne = Math.min(999, Math.max(-99, v));
  const arrondi1 = Math.round(borne * 10) / 10;
  const texte = Math.abs(arrondi1) < 10
    ? arrondi1.toFixed(1).replace('.', ',')
    : String(Math.round(borne));
  return texte.replace(/^-0,0$/, '0,0').padStart(4, ' ');
}

/**
 * Puissance en kW, entière, sur 4 caractères (complétée par des espaces à gauche) : « 3 », « -12 », « 105 ».
 * Bornée entre -99 (récupération) et 999 : une Model Y ne dépasse pas ces valeurs.
 */
export function textePuissance(v) {
  if (v == null || !Number.isFinite(v)) return '  --';
  const n = Math.round(Math.min(999, Math.max(-99, v)));
  return String(n === 0 ? 0 : n).padStart(4, ' '); // évite « -0 »
}

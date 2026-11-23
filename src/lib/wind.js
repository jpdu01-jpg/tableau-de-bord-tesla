// Vent relatif au déplacement de la voiture. Fonction pure, testée dans tests/wind.test.js.
import { angleDiff, normalize360 } from './geo.js';

/**
 * @param ventVientDe direction météo du vent en degrés (d'où il VIENT : 0 = vent du nord)
 * @param vitesseVent vitesse du vent (unité libre, conservée dans le résultat)
 * @param cap         cap de la voiture en degrés (0 = nord)
 * @returns {
 *   angleRelatif : d'où vient le vent par rapport à l'avant de la voiture
 *                  (0 = de face, 90 = de la droite, 180 = de l'arrière, -90 = de la gauche),
 *   rotationFleche : sens dans lequel souffle le vent, vu du dessus avec l'avant de la voiture en haut,
 *   face : composante de face (positive = vent de face, négative = vent arrière),
 *   lateral : composante latérale (positive = poussée venant de la droite),
 *   libelle : texte court en français
 * }
 */
export function relativeWind(ventVientDe, vitesseVent, cap) {
  const angleRelatif = angleDiff(cap, ventVientDe);
  const r = (angleRelatif * Math.PI) / 180;
  const face = vitesseVent * Math.cos(r);
  const lateral = vitesseVent * Math.sin(r);
  return {
    angleRelatif,
    rotationFleche: normalize360(angleRelatif + 180),
    face,
    lateral,
    libelle: libelleVent(angleRelatif, vitesseVent),
  };
}

function libelleVent(angle, vitesse) {
  if (vitesse < 5) return 'Vent faible';
  const a = Math.abs(angle);
  if (a <= 30) return 'Vent de face';
  if (a >= 150) return 'Vent arrière';
  const cote = angle > 0 ? 'droite' : 'gauche';
  if (a <= 60) return `De face, ${cote}`;
  if (a >= 120) return `Arrière, ${cote}`;
  return `Latéral ${cote}`;
}

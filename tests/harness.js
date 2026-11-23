// Mini-outil de test sans dépendance : test(nom, fn) + assertions, résultats affichés dans la page.
const resultats = [];

export function test(nom, fn) {
  try {
    fn();
    resultats.push({ nom, ok: true });
  } catch (e) {
    resultats.push({ nom, ok: false, erreur: e.message });
  }
}

export function egal(obtenu, attendu, message = '') {
  if (obtenu !== attendu) throw new Error(`${message} attendu ${JSON.stringify(attendu)}, obtenu ${JSON.stringify(obtenu)}`);
}

export function proche(obtenu, attendu, tolerance, message = '') {
  if (obtenu == null || Math.abs(obtenu - attendu) > tolerance) {
    throw new Error(`${message} attendu ${attendu} ± ${tolerance}, obtenu ${obtenu}`);
  }
}

export function vrai(condition, message = 'condition fausse') {
  if (!condition) throw new Error(message);
}

export function afficher() {
  const echecs = resultats.filter((r) => !r.ok);
  const resume = document.getElementById('resume');
  resume.textContent = echecs.length
    ? `❌ ${echecs.length} échec(s) sur ${resultats.length} tests`
    : `✅ ${resultats.length} tests réussis`;
  resume.className = echecs.length ? 'ko' : 'ok';
  document.getElementById('liste').innerHTML = resultats
    .map((r) => `<li class="${r.ok ? 'ok' : 'ko'}">${r.ok ? '✔' : '✘'} ${r.nom}${r.ok ? '' : `<br><small>${r.erreur}</small>`}</li>`)
    .join('');
  window.__resultatsTests = { total: resultats.length, echecs: echecs.length }; // lu par les vérifications automatiques
}

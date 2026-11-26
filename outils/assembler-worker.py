"""Fabrique relais/borne-worker.js (à coller dans Cloudflare) à partir de relais/borne-worker.modele.js et des calculs
testés de l'app (src/lib/geo.js, navigation.js, bornes.js) : l'éditeur de Cloudflare n'accepte qu'un seul fichier,
on y recopie donc ces bibliothèques, sans leurs lignes import/export.

Usage, après toute modification de ces fichiers :  python3 outils/assembler-worker.py
(tests/bornes.test.js vérifie que la copie est à jour.)
"""
import os
import re

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BIBLIOTHEQUES = ['src/lib/geo.js', 'src/lib/navigation.js', 'src/lib/bornes.js']
MARQUE = '//@@BIBLIOTHEQUE@@'


def sans_modules(texte):
    """Retire les lignes « import … » et le mot « export » en début de ligne."""
    lignes = [l for l in texte.splitlines() if not l.startswith('import ')]
    return '\n'.join(re.sub(r'^export (default )?', '', l) for l in lignes)


def lire(chemin):
    with open(os.path.join(RACINE, chemin), encoding='utf-8') as f:
        return f.read()


if __name__ == '__main__':
    modele = lire('relais/borne-worker.modele.js')
    assert MARQUE in modele
    copies = '\n'.join(f'// ===== copie de {c} (ne pas modifier ici) =====\n{sans_modules(lire(c))}' for c in BIBLIOTHEQUES)
    entete = '// FICHIER FABRIQUÉ par outils/assembler-worker.py : modifier relais/borne-worker.modele.js ou src/lib/.\n'
    sortie = os.path.join(RACINE, 'relais/borne-worker.js')
    with open(sortie, 'w', encoding='utf-8') as f:
        f.write(entete + modele.replace(MARQUE, copies))
    print(f'{sortie} ({os.path.getsize(sortie) // 1024} Ko)')

"""Liste des stations de recharge rapide utilisées par le changement de borne à la voix (relais/borne-worker.js).

Source : Base nationale des IRVE (data.gouv.fr, données publiques, mise à jour quotidienne), interrogée par son API
« tabular » : seules les lignes utiles sont lues, sans télécharger le fichier complet (plus de 100 Mo).
Résultat : data/bornes.json, publié avec l'app sur GitHub Pages et lu par le Worker.

Usage (de temps en temps, pour suivre les nouvelles stations) :  python3 outils/bornes.py
"""
import json
import os
import re
import subprocess
import urllib.parse

RESSOURCE = 'eb76d20a-8501-400e-b336-d85724de5435'  # « Consolidation de la dernière version à date du schéma »
API = f'https://tabular-api.data.gouv.fr/api/resources/{RESSOURCE}/data/'
PUISSANCE_MIN_KW = 50  # recharge rapide seulement (pas les bornes de parking à 22 kW)

# Réseaux : code court → filtre sur l'opérateur. Partenaires Electra : alliance ChargeLeague (Ionity, Atlante ;
# Fastned est absent de la base nationale à ce jour).
RESEAUX = {
    'tesla': 'TESLA',
    'electra': 'ELECTRA',
    'ionity': 'IONITY',
    'atlante': 'Atlante',
}
COLONNES = ['nom_operateur', 'nom_station', 'adresse_station', 'consolidated_latitude', 'consolidated_longitude',
            'puissance_nominale']
SORTIE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'bornes.json')


def lignes(operateur):
    """Toutes les lignes (une par point de charge) dont l'opérateur contient `operateur`."""
    page = 1
    while True:
        params = {'nom_operateur__contains': operateur, 'page_size': 200, 'page': page, 'columns': ','.join(COLONNES)}
        # curl plutôt qu'urllib : le Python installé sur le Mac n'a pas toujours les certificats web
        texte = subprocess.run(['curl', '-sf', '--max-time', '60', f'{API}?{urllib.parse.urlencode(params)}'],
                               check=True, capture_output=True, text=True).stdout
        donnees = json.loads(texte)
        yield from donnees['data']
        if page * 200 >= donnees['meta']['total']:
            return
        page += 1


def nom_lisible(reseau, l):
    """Nom à lire à voix haute : « Agen » plutôt que « Agen, France » ; l'adresse quand le nom n'est qu'un code."""
    nom = (l['nom_station'] or '').strip().replace('ę', 'ê')  # coquille d'encodage dans la base (Angoulęme)
    nom = nom.removesuffix(', France')
    if not nom or '/' in nom or re.fullmatch(r'[A-Z]{2}\*?[A-Z0-9*]{4,}', nom):  # ex. « Atlante France/FRATLFR00282 »
        nom = (l['adresse_station'] or reseau).strip()
    return nom


def stations(reseau, operateur):
    """Regroupe les points de charge d'une même station (à ~100 m près) ; garde les stations rapides."""
    par_lieu = {}
    for l in lignes(operateur):
        if operateur.lower() not in (l['nom_operateur'] or '').lower():
            continue
        lat, lon, kw = l['consolidated_latitude'], l['consolidated_longitude'], l['puissance_nominale'] or 0
        if lat is None or lon is None:
            continue
        cle = (round(lat, 3), round(lon, 3))  # même station : même endroit, à ~100 m près
        s = par_lieu.setdefault(cle, {'reseau': reseau, 'nom': nom_lisible(reseau, l),
                                      'lat': round(lat, 5), 'lon': round(lon, 5), 'kw': 0, 'pdc': 0})
        s['kw'] = max(s['kw'], round(kw))
        s['pdc'] += 1
    return [s for s in par_lieu.values() if s['kw'] >= PUISSANCE_MIN_KW]


if __name__ == '__main__':
    toutes = []
    for reseau, operateur in RESEAUX.items():
        liste = stations(reseau, operateur)
        print(f'{reseau:8} {len(liste):5} stations rapides')
        toutes += liste
    toutes.sort(key=lambda s: (s['reseau'], s['nom']))
    os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
    with open(SORTIE, 'w', encoding='utf-8') as f:
        json.dump(toutes, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    print(f'{len(toutes)} stations → {SORTIE} ({os.path.getsize(SORTIE) // 1024} Ko)')

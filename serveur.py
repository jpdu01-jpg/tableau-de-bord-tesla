"""Serveur de développement local : sert le dossier du projet en interdisant le cache du navigateur,
pour que chaque modification soit visible immédiatement. Usage : python3 serveur.py  →  http://localhost:8173"""
import functools
import http.server
import os

PORT = 8173
DOSSIER = os.path.dirname(os.path.abspath(__file__))


class SansCache(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


if __name__ == "__main__":
    gestionnaire = functools.partial(SansCache, directory=DOSSIER)
    print(f"Tableau de bord : http://localhost:{PORT}  (démo : /?demo=1, tests : /tests/)")
    http.server.ThreadingHTTPServer(("127.0.0.1", PORT), gestionnaire).serve_forever()

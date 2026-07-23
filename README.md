DEPLOY SJØØRRET LIVE KART v11 PÅ RENDER

1. Koble Render Web Service til GitHub-repoet.
2. Runtime: Node.
3. Build command: npm install
4. Start command: npm start
5. Health check path: /api/health
6. Valgfritt: sett MET_USER_AGENT til en nøytral identifikator med offentlig prosjektadresse.

Etter deploy skal /api/health svare:
{"ok":true,"version":"v11"}

Kjør npm test før hver deploy.

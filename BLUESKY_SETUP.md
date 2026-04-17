# Bluesky Auto-Post Setup (Task #25)

Auto-post sur Bluesky via AT Protocol — gratuit, API REST propre, pas de lib externe.

## 1. Créer le compte + app password

1. Crée un compte Bluesky (si pas déjà fait) : https://bsky.app
2. Note ton handle complet, ex : `snowdiablo.bsky.social`
3. Va sur **Settings → Privacy and Security → App Passwords**
4. Clic **"Add App Password"** → nomme-le `snake-backend`
5. Copie le password généré (format `xxxx-xxxx-xxxx-xxxx`) — **il ne sera affiché qu'une fois**

> ⚠️ NE PAS utiliser ton password principal. L'app password est révocable sans affecter ton compte.

## 2. Railway env vars

Dans project `snake-backend` → Variables :

```
BSKY_HANDLE       = snowdiablo.bsky.social
BSKY_APP_PASSWORD = xxxx-xxxx-xxxx-xxxx
```

Railway redéploie auto ~60s.

## 3. Vérification

Logs Railway doivent afficher au boot :
```
🦋 Bluesky: session ready for snowdiablo.bsky.social (did=did:plc:abc123...)
🦋 Bluesky bot enabled → snowdiablo.bsky.social
```

Status endpoint :
```powershell
Invoke-RestMethod "https://snake-backend-production-e5e8.up.railway.app/api/admin/bsky/status" -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"}
# → enabled:True, session:True, queue_size:0
```

Test post manuel :
```powershell
$body = @{ text = "🐍 SnakeCoin bot test — live auto-post working https://snakegame.live #SnakeCoin" } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri "https://snake-backend-production-e5e8.up.railway.app/api/admin/bsky/post" -Headers @{Authorization="Bearer $env:ADMIN_TOKEN"} -ContentType "application/json" -Body $body
# → ok:True, uri:"at://did:plc:.../app.bsky.feed.post/...", cid:"..."
```

Le post apparaît sur ton feed Bluesky. Les URLs sont automatiquement cliquables (facets AT Protocol gérés auto).

## 4. Events auto-postés

| Trigger | Exemple post |
|---------|--------------|
| Nouveau record all-time | `🐍 NEW ALL-TIME RECORD on SnakeCoin! 0xe59d...f539 just scored 127. Can you beat it? https://snakegame.live #SnakeCoin #P2E #Polygon` |
| Whale milestone (≥500 cumul) | `🚀 WHALE ALERT on SnakeCoin 🐍 0xe59d...f539 just crossed 500 $SNAKE cumulative...` |
| Golden Snake event start | `⚡ GOLDEN SNAKE MODE ACTIVE ⚡ Every claim gives x3 $SNAKE right now...` |

## 5. Rate limiting & anti-spam

- **Minimum 5 minutes** entre deux posts auto
- Queue max 10 messages, drain quand le cooldown expire
- Admin `POST /api/admin/bsky/post` **bypass** le rate-limit (manual override)

## 6. Limites techniques Bluesky

- **300 caractères** max par post (le backend cap auto)
- Les URLs comptent dans le total de chars
- Facets auto-générés pour les liens (clickable dans l'app)
- Session JWT valide ~2h, re-auth transparent à l'expiration

## 7. Disable

Supprime `BSKY_HANDLE` et/ou `BSKY_APP_PASSWORD` dans Railway → au prochain boot :
```
🦋 Bluesky disabled (set BSKY_HANDLE + BSKY_APP_PASSWORD to enable)
```

Le reste du backend fonctionne normalement.

## 8. Troubleshooting

| Symptôme | Cause | Fix |
|----------|-------|-----|
| `createSession 401` | App password invalide | Regénère dans Settings Bluesky |
| `createSession 400 InvalidIdentifier` | Handle mal formaté | Vérifie que c'est `xxx.bsky.social` complet |
| `session:false` en permanence | Network Railway bloqué vers bsky.social | Rare, check Railway egress |
| Posts pas clickables | facets mal générés | Le backend gère auto via regex URL, normalement OK |
| `createRecord 400 RateLimitExceeded` | Trop de posts en peu de temps | Le backend cap déjà à 5min, Bluesky PDS limit ~5000/jour |

## 9. Bonus : facets handles @

Si tu veux mentionner un handle Bluesky (ex `@snowdiablo.bsky.social`), il faut resoudre le DID via :
```
GET /xrpc/com.atproto.identity.resolveHandle?handle=snowdiablo.bsky.social
```
Puis ajouter un facet `app.bsky.richtext.facet#mention` avec le DID. Pas fait pour l'instant (pas de cas d'usage actuel), mais le code est extensible.

---

**Task #25 status** : code deployed, env vars à configurer pour activation.

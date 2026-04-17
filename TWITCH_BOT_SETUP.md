# Twitch Bot Setup (Task #24)

Bot Twitch inline dans `server.js` (tmi.js IRC). Réagit aux events du jeu + commandes viewers.

## 1. Obtenir les credentials

### Compte bot (recommandé)
Crée un **compte Twitch séparé** pour le bot (ex: `SnakeCoinBot`) ou utilise ton compte principal.

### OAuth token
Va sur **https://twitchtokengenerator.com/** → sélectionne les scopes :
- `chat:read`
- `chat:edit`

Puis copie le token **Access Token** (format `oauth:xxxxxxxxxxxxx`).

> ⚠️ Alternative si tu veux rester officiel : crée une app sur https://dev.twitch.tv/console/apps puis fais un flow OAuth manuel — plus complexe mais plus propre pour prod.

## 2. Variables d'environnement Railway

Dans le project `snake-backend` → Variables :

```
TWITCH_CHANNEL=snowdiablo          # ton channel (sans #)
TWITCH_USERNAME=snakecoinbot       # le compte bot (minuscules)
TWITCH_OAUTH=oauth:xxxxxxxxxxxxxx  # le token du step 1
```

Railway redéploie auto après ajout.

## 3. Vérification

```bash
# Logs Railway doivent afficher au boot :
🟣 Twitch IRC connected → #snowdiablo via irc-ws.chat.twitch.tv:443

# Status endpoint (admin)
curl "https://snake-backend-production-e5e8.up.railway.app/api/admin/twitch/status" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# → {"enabled":true,"connected":true,"channel":"#snowdiablo",...}

# Envoyer un message test
curl -X POST "https://snake-backend-production-e5e8.up.railway.app/api/admin/twitch/say" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":"🐍 Bot online !"}'
```

## 4. Events automatiques

Le bot poste automatiquement dans ton chat Twitch :

| Trigger | Exemple message |
|---------|-----------------|
| Claim ≥ 10 SNAKE | `💰 0xe59d...f539 just claimed 25 $SNAKE 🐍` |
| Milestone total claimed (10/50/100/500/1000/5000) | `💎 0xe59d...f539 just hit 100 $SNAKE cumulative!` |
| Whale alert (≥500 cumulés) | `💎 ... 🚀 WHALE ALERT` |
| Streak milestone (3/7/14/30/50/100j) | `🔥 0xe59d...f539 is on a 7-day streak!` |
| Legend streak (≥30j) | `... LEGEND STATUS 👑` |
| Golden Snake ON | `⚡⚡⚡ GOLDEN SNAKE MODE ON x3 rewards! 🐍💰` |
| Golden Snake OFF | `⚡ Golden Snake event ended. Back to normal x1.` |

## 5. Commandes viewers

Un viewer tape dans le chat Twitch :

| Commande | Effet |
|----------|-------|
| `!snake` | Lien du jeu + Discord |
| `!top` | Top 3 scores all-time |
| `!stats` | Totaux (players / claims / SNAKE distribués) |
| `!golden` | État event Golden Snake (actif ou next) |
| `!score 0x...` | Stats d'un wallet (best score, games, SNAKE claimed) |
| `!quests 0x...` | Progression des 3 quêtes du jour |

## 6. Rate limiting

- 15 messages/30s (queue + bucket refill 1 token / 2s)
- Queue max 30 messages (anciens droppés si overflow)
- Safe margin sous la limite Twitch officielle (20 msg/30s pour comptes normaux)

## 7. Disable

Supprime simplement `TWITCH_CHANNEL` dans les env Railway → le bot log `Twitch bot disabled` au boot et ne se connecte pas. Le reste du backend fonctionne normalement.

## 8. Troubleshooting

| Symptôme | Cause probable | Fix |
|----------|---------------|-----|
| `Login authentication failed` | OAuth token expiré ou mauvais scope | Regénère sur twitchtokengenerator.com avec `chat:read` + `chat:edit` |
| `connected:false` en permanence | Mauvais channel ou username | Vérifie que channel = sans `#`, username en minuscules |
| Bot ne réagit pas aux commandes | Pas en modo de ton chat | Le bot peut poster même sans être modo, vérifie slow-mode / sub-only |
| Messages tronqués | Dépasse 500 chars | Twitch IRC cap ~500 chars, notre bot coupe à 480 |
| Rate-limited | Trop d'events simultanés | Attendre — la queue draine à 1msg/2s |

---

**Task #24 status** : code deployed, env vars à configurer pour activation.

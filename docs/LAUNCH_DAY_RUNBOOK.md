# LAUNCH DAY RUNBOOK — SnakeCoin P2E (snowdiablo.xyz)

Séquence ordonnée pour le jour du reveal public. Suit les DEPLOY_*.md individuels.

## T-7 jours — Préparation

- [ ] Pre-deploy check complet : `node --check server.js`, tests locaux, lint
- [ ] Backup SQLite volume Railway complet (`pg_dump` équivalent via task #12)
- [ ] Vérifier monitoring Uptime Kuma tous green sur :
  - `/api/leaderboard`
  - `/api/tournament/current`
  - `/api/clan/list`
  - `/api/boost/catalog`
  - `/api/nft/eligibility`
- [ ] Rotate toutes les clés API (Alchemy, Pinata, Polygonscan)
- [ ] Charger le signer wallet avec assez de POL (20+ POL safety)
- [ ] Acheter domain snowdiablo.xyz redirect si ça expire bientôt

## T-3 jours — Stealth soft-launch

- [ ] Activate `TOURNAMENT_ENABLED=1` + `CLAN_ENABLED=1` sans announce (voir [DEPLOY_TOURNAMENTS_CLANS.md](./DEPLOY_TOURNAMENTS_CLANS.md))
- [ ] Laisser 48h de soft test avec core community (20-30 early players)
- [ ] Check logs Railway pour aucune erreur stack trace
- [ ] Smoke test : faire un cycle tournoi complet (entry → jouer → payout)
- [ ] Test create clan + join + leave flow end-to-end

## T-1 jour — Deploy contracts manquants

- [ ] Deploy SnakeBoostNFT mainnet (voir [DEPLOY_BOOST_NFT.md](./DEPLOY_BOOST_NFT.md))
- [ ] Premier mint test par deployer → valider tokenURI + royalty
- [ ] Activate `BOOST_NFT_ADDRESS` sur Railway
- [ ] Check que les 4 tiers s'affichent sur le front
- [ ] Marketing assets prêts dans `marketing/`:
  - launch_tweet.md
  - discord_announce.md
  - launch_banner.png

## T-0 — LAUNCH DAY

### H-2 — Pre-flight check
- [ ] Tous les services Uptime Kuma green
- [ ] Wallet deployer checked (POL balance OK, $SNAKE balance OK)
- [ ] Railway logs clean sur 24h derniers
- [ ] Screen-share setup pour stream

### H-1 — DEX Liquidity
- [ ] Start stream Twitch "Launch $SNAKE LIVE"
- [ ] Ouvrir QuickSwap v3 Add Liquidity (voir [DEPLOY_DEX_LIQUIDITY.md](./DEPLOY_DEX_LIQUIDITY.md))
- [ ] Approve + Add Liquidity → screenshot tx
- [ ] Verify pool address sur QuickSwap info
- [ ] Lock LP NFT via UNCX 12 mois → screenshot
- [ ] Renounce ownership token → screenshot

### H+0 — Announce
- [ ] Post Twitter/X (epingle)
- [ ] Post Discord pinned #announcements
- [ ] Post Bluesky
- [ ] Update site banner "$SNAKE IS LIVE — BUY ON QUICKSWAP"
- [ ] DM liste whales/investors/partners (~30 noms prévus)
- [ ] Submit DEX Screener update (logo + socials)

### H+1 — Monitoring
- [ ] Watch DEX Screener volume 1ère heure
- [ ] Watch Railway logs pour spike traffic
- [ ] Watch Discord for community feedback
- [ ] Respond to questions en live stream

### H+2 à H+6 — Community support
- [ ] Prepare FAQ Discord pour onboarding
- [ ] Streak-boost giveaway (50 $SNAKE airdrop aux 20 premiers connects)
- [ ] Monitor cheats attempts via task #9 (anti-cheat logs)
- [ ] Handle les tickets Discord

### H+24 — Review
- [ ] Stats recap : volume DEX, holders, mints NFT trophy, mints boost, tournois entries
- [ ] Post retrospective Discord
- [ ] Plan tweaks for week 1

## Fallback scenarios

### Scenario A : Price dump 50%+ en 1h
- **Ne pas** paniquer, LP est locked donc pas rug possible
- Communication transparente : "C'est volatile, holders > traders"
- Optional : pause claims temporairement pour laisser stabiliser

### Scenario B : Backend down / 500 errors
- Check Railway logs immédiatement
- Si DB issue : restore from backup task #12
- Fallback statique : freeze site avec message "Maintenance" + cron disable
- Post Discord apology + ETA

### Scenario C : Attack / exploit
- Pause immédiat : `TOURNAMENT_ENABLED=0`, `CLAN_ENABLED=0`, `BOOST_ENABLED=0`
- Si exploit contract (rare) : contact OpenZeppelin Defender pour pause
- Post-mortem dans les 24h

### Scenario D : Overwhelmed by success
- Scale Railway plan up (Pro → Pro+)
- Add CDN layer sur WebHostOp
- Rate limit plus agressif sur endpoints publics
- Potentiellement migrer DB vers Postgres si SQLite bottleneck

## Post-launch week 1

- Daily Discord standup avec community
- Twitter engagement 2x/day
- Weekly tournoi wrap-up embed auto-posted
- Weekly clan payout announcement
- Stream 2-3x/semaine Twitch pour retention

## KPIs à tracker

- DAU (daily active users) : viser 500+ en J+7
- Volume DEX 24h : viser $50k+ en J+7
- Holders $SNAKE : viser 500+ en J+7
- Top trophy mints : viser 50+ en J+30
- Boost NFT mints : viser 100+ en J+30
- Discord members : viser 2000+ en J+14

---

**Status systems (au moment de la rédaction) :**
- ✅ Backend stack : 100% prêt (tasks 1-93 completed)
- ✅ Tournois + Clans : UI + backend live-ready (#94 #95 completed)
- ⏳ Boost NFT : contract à deployer (#66 pending)
- ⏳ DEX liquidity : à setup day-of (#65 in_progress)

**Reste à faire en autonome :**
- ✨ Aucune task autonomous blocker — attend actions user (contract deploy + LP setup)

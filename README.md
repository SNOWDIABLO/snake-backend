# 🐍 SnakeCoin P2E

> A Play-to-Earn Snake game on **Polygon**. Earn real on-chain rewards and mint seasonal NFT trophies.

🎮 **Play:** [snowdiablo.xyz](https://snowdiablo.xyz)
🏆 **Leaderboard:** [Hall of Fame](https://snowdiablo.xyz/hall-of-fame.html)
🎨 **NFT Collection:** available on OpenSea, Rarible, Blur and directly in-game.

---

## ✨ What it does

- 🎮 Modern web Snake (desktop keyboard + mobile touch/swipe) with server-side anti-cheat
- 💰 On-chain **$SNAKE** ERC-20 token — earn by playing, claim on Polygon
- 🔥 Daily streaks, quests, and a recurring weekly "Golden Snake" event
- 🏅 Seasonal NFT trophies (ERC-721) for top 10 players — on-chain SVG art, Chainlink-priced, royalty-enabled, permanent in-game bonus multiplier
- 🌍 Available in **13 languages**
- 📢 Live community feeds (Discord, Twitch, Bluesky) — record-breaks, whale claims, trophy mints broadcasted automatically
- 🛡️ Holder-gated Discord role auto-assigned from on-chain balance

---

## 🧰 Built with

Node.js · Express · SQLite · ethers.js · Solidity · Chainlink · OpenZeppelin · discord.js · WalletConnect v2 · helmet · express-rate-limit

Deployed across a cloud backend, a CDN-hosted frontend, and a dedicated Linux VPS for the bots — all wired together with a proper CI/CD pipeline, monitoring and alerting.

---

## 🛡️ Security

- Server-side anti-cheat with multiple heuristics (timing, score caps, per-wallet rate limits)
- EIP-191 wallet ownership proofs required for sensitive actions
- Signer-gated smart contracts with on-chain anti-replay nonces
- Rate-limiting on every public endpoint
- Admin surface behind bearer auth
- Wallet addresses redacted in logs
- CORS locked to known origins

The architecture, operational details, internal APIs, secrets management and full source of the backend / contracts are **not public**. Only the gameplay surface is.

---

## 📦 What's in this repo

This repository is the **public-facing snapshot** of the game (frontend + documentation).
Backend, bots, smart-contract sources, deployment scripts and infrastructure configs live in **separate private repos** and are not shared here.

---

## 🎨 NFT Trophies

Top 10 players each season mint a one-of-a-kind on-chain trophy NFT (Gold / Silver / Bronze / Top10).

- **View on-chain:** Polygonscan's NFT tab on the trophy contract
- **Preview in-game:** "My Trophies" section on [snowdiablo.xyz](https://snowdiablo.xyz) (connect your wallet)
- **Buy / trade:** OpenSea, Rarible, Blur — the collection is fully EIP-2981 compliant (5% royalty flows back to the project)

Each trophy tier also unlocks a permanent in-game $SNAKE reward multiplier.

---

## 📄 License & usage

© SnowDiablo — all rights reserved on backend logic, smart-contract internals, art assets and brand.

The frontend code in this repo is provided for **transparency only**. Forking, redistributing, rebranding or deploying a copy of this project (or any substantial part of it) is **not permitted** without explicit written permission.

Bug reports, ideas and PRs on cosmetic / UX issues are welcome — open an issue.

---

## 🤝 Contact

- **Streamer & creator:** [@SnowDiablo on Twitch](https://twitch.tv/snowdiablo)
- **Discord:** invite link on [snowdiablo.xyz](https://snowdiablo.xyz)
- **Business inquiries:** via Twitch / Discord DMs

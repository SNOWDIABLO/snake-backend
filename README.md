# 🐍 SnakeCoin P2E

> A Play-to-Earn Snake game on **Polygon**. Earn real on-chain rewards and mint seasonal NFT trophies.

[![Live](https://img.shields.io/website?url=https%3A%2F%2Fsnowdiablo.xyz&label=Live%20demo&style=flat-square&color=brightgreen)](https://snowdiablo.xyz)
[![Polygon](https://img.shields.io/badge/Polygon-8247E5?style=flat-square&logo=polygon&logoColor=white)](https://polygonscan.com)
[![Node.js](https://img.shields.io/badge/Node.js%2018+-339933?style=flat-square&logo=nodedotjs&logoColor=white)](https://nodejs.org)
[![Solidity](https://img.shields.io/badge/Solidity-363636?style=flat-square&logo=solidity&logoColor=white)](https://soliditylang.org)
[![ethers.js](https://img.shields.io/badge/ethers.js-v6-2535A0?style=flat-square&logo=ethereum&logoColor=white)](https://docs.ethers.org)
[![License](https://img.shields.io/badge/License-Proprietary-red?style=flat-square)](#-license--usage)

🎮 **Play:** [snowdiablo.xyz](https://snowdiablo.xyz) · 🏆 **Leaderboard:** [Hall of Fame](https://snowdiablo.xyz/hall-of-fame.html) · 🎨 **NFT Collection:** OpenSea, Rarible, Blur

---

## 🧰 Tech Stack

| Layer | Tech |
|---|---|
| **Backend** | Node.js · Express · SQLite (`better-sqlite3`) · ethers.js v6 · helmet · express-rate-limit |
| **Smart contracts** | Solidity 0.8 · Hardhat · OpenZeppelin · Chainlink (MATIC/USD price feed) |
| **Frontend** | Vanilla JS · ethers.js (UMD) · WalletConnect v2 (EthereumProvider) |
| **Bots** | discord.js · AT Protocol (Bluesky) · Twitch IRC |
| **Infra** | Railway (backend, auto-deploy on `git push`) · WebHostOp (CDN frontend via FTP) · Linux VPS (PM2 bots) · GitHub Actions CI/CD |

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

## 🧠 Engineering highlights

A few of the harder problems I solved building this solo:

- **Server-authoritative anti-cheat** — multi-heuristic detection (frame timing, max points-per-second per game type, score caps, per-wallet rate limits) so a player can't fabricate scores client-side.
- **EIP-191 wallet ownership proofs** — every sensitive action (link, claim, mint) requires a fresh signature from the wallet, validated server-side with on-chain anti-replay nonces.
- **On-chain rewards with off-chain throttling** — daily caps + per-session caps in SQLite, rewards signed by a dedicated signer wallet, claimed atomically on the smart contract.
- **NFT trophies with EIP-2981 royalties + Chainlink USD pricing** — secondary-sale royalties (5%) flow back to the project; mint price stays USD-stable thanks to the MATIC/USD price feed.
- **Real-time multi-platform broadcasts** — every record-break, whale claim and trophy mint pushed live to Discord, Bluesky and Twitch via dedicated bot processes on a separate VPS.
- **Race-condition hardened** — `DAILY_LIMIT` enforcement uses SQLite transactions to prevent double-spend under concurrent claims.

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

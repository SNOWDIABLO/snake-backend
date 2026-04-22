# Phase 5 — 6 canvas games shipped

Status : **DONE** (engines + i18n + Vite build green). Reste juste à push.

## Livrables

| Jeu | Engine | Main | Style | HTML | Canvas | Ratio |
|---|---|---|---|---|---|---|
| Snake | `src/snake-game.js` | `src/main-snake.js` | `src/snake-style.css` | `snake/index.html` | — | 10 pts = 1 $SNAKE |
| Pong | `src/pong-game.js` | `src/main-pong.js` | `src/pong-style.css` | `pong/index.html` | 800×400 | 10 rallies = 1 $SNAKE |
| Flappy | `src/flappy-game.js` | `src/main-flappy.js` | `src/flappy-style.css` | `flappy/index.html` | 400×600 | 10 pipes = 1 $SNAKE |
| Breakout | `src/breakout-game.js` | `src/main-breakout.js` | `src/breakout-style.css` | `breakout/index.html` | 720×480 | 10 bricks = 1 $SNAKE |
| Invaders | `src/invaders-game.js` | `src/main-invaders.js` | `src/invaders-style.css` | `space-invaders/index.html` | 720×540 | 10 kills = 1 $SNAKE |
| 2048 | `src/game2048-game.js` | `src/main-2048.js` | `src/game2048-style.css` | `2048/index.html` | 500×500 | 100 pts = 1 $SNAKE |
| Minesweeper | `src/minesweeper-game.js` | `src/main-minesweeper.js` | `src/minesweeper-style.css` | `minesweeper/index.html` | 400×400 | 10 cells = 1 $SNAKE |

## i18n

13 locales × **183 keys** chacune (+61 vs baseline 122). Aligné parfait :

```
ar de en es fr id it ja ko pt ru tr zh  -> 183 keys each
```

## Vite build

```
dist/2048/index.html            2.95 kB
dist/pong/index.html            2.98 kB
dist/flappy/index.html          2.99 kB
dist/breakout/index.html        3.02 kB
dist/space-invaders/index.html  3.02 kB
dist/minesweeper/index.html     3.21 kB

dist/assets/game2048-*.js        7.71 kB │ gzip: 3.18 kB
dist/assets/breakout-*.js        8.49 kB │ gzip: 3.26 kB
dist/assets/minesweeper-*.js     8.49 kB │ gzip: 3.39 kB
dist/assets/flappy-*.js          8.68 kB │ gzip: 3.42 kB
dist/assets/pong-*.js            9.48 kB │ gzip: 3.52 kB
dist/assets/invaders-*.js        9.81 kB │ gzip: 3.71 kB
dist/assets/shared-*.js         18.63 kB │ gzip: 6.32 kB

✓ built in 468ms — 54 modules transformed — 11 pages total
```

## Intégration backend Phase 4

Chaque `main-*.js` envoie `game: GAME_ID` à `/api/session/start` :

```js
const GAME_ID = 'flappy';  // 'pong' | 'breakout' | 'space-invaders' | '2048' | 'minesweeper'
await api.sessionStart({ address: getAddress(), game: GAME_ID });
```

Backend multi-games (déjà shipped Phase 4) segmente les sessions/leaderboards par `game`.

## Flow claim (identique tous les jeux)

1. `sessionStart({address, game})` → `sessionId`
2. gameplay → `onGameOver({score, tokens})`
3. `sessionEnd({sessionId, score, address})` → reward signé (+ streak/NFT/boost)
4. `getWalletProof('Claim')` → EIP-191 nonce signature
5. `api.claim({address, sessionId, proof})` → `{amount, nonce, sig}`
6. `contract.claimReward(amount, nonce, sig)` → Polygon tx

## Reste à faire

1. **Push** — exécuter `PHASE5_SHIP.ps1` depuis PowerShell (hors OneDrive) :
   ```powershell
   cd C:\dev\snake-backend
   & "C:\Users\Alien Ware\OneDrive\claude creation\snake-backend\PHASE5_SHIP.ps1"
   ```
2. **Smoke tests** post-deploy (script les affiche)
3. **E2E test** : connect wallet → joue 1 partie de chaque jeu → vérifier `SELECT game, COUNT(*) FROM sessions GROUP BY game` côté DB
4. **Tasks à clôturer** : #114 (Phase 5) → done | #108 (frontend v2) → done

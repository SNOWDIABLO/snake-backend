import { defineConfig } from 'vite';
import { resolve } from 'path';

// Multi-page app — chaque entrée = une page HTML distincte
// Build output: dist/index.html, dist/snake/index.html, dist/pong/index.html, etc.
// Shared modules (src/*) sont auto-bundlés et partagés via imports ESM.

export default defineConfig({
  root: '.',
  publicDir: 'public',
  base: '/',

  // Fix SES/LavaMoat de MetaMask qui strip les intrinsics ES2022+
  // (Map.prototype.getOrInsert, etc). On force es2020 partout pour éviter
  // ces features, sinon WalletConnect init crash sur Brave/Chrome avec MM.
  define: {
    global: 'globalThis',
  },
  optimizeDeps: {
    esbuildOptions: {
      target: 'es2020',
    },
  },

  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        main:         resolve(__dirname, 'index.html'),
        snake:        resolve(__dirname, 'snake/index.html'),
        pong:         resolve(__dirname, 'pong/index.html'),
        flappy:       resolve(__dirname, 'flappy/index.html'),
        invaders:     resolve(__dirname, 'space-invaders/index.html'),
        breakout:     resolve(__dirname, 'breakout/index.html'),
        minesweeper:  resolve(__dirname, 'minesweeper/index.html'),
        game2048:     resolve(__dirname, '2048/index.html'),
        leaderboard:  resolve(__dirname, 'leaderboard/index.html'),
        profile:      resolve(__dirname, 'profile/index.html'),
        lpfund:       resolve(__dirname, 'lp-fund/index.html')
      },
      output: {
        // Groupe les chunks partagés (wallet, api, header, footer) dans un seul bundle.
        // i18n.js sera rajouté quand une page l'importera — sinon Vite warn "entry not found".
        manualChunks(id) {
          if (!id.includes('/src/')) return;
          if (id.endsWith('/src/wallet.js') ||
              id.endsWith('/src/api.js')    ||
              id.endsWith('/src/header.js') ||
              id.endsWith('/src/footer.js')) {
            return 'shared';
          }
        }
      }
    }
  },

  server: {
    port: 5173,
    open: '/',
    host: true
  },

  preview: {
    port: 4173,
    host: true
  }
});

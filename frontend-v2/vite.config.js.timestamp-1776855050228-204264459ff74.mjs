// vite.config.js
import { defineConfig } from "file:///sessions/jolly-pensive-wozniak/mnt/snake-backend/frontend-v2/node_modules/vite/dist/node/index.js";
import { resolve } from "path";
var __vite_injected_original_dirname = "/sessions/jolly-pensive-wozniak/mnt/snake-backend/frontend-v2";
var vite_config_default = defineConfig({
  root: ".",
  publicDir: "public",
  base: "/",
  build: {
    outDir: "dist",
    assetsDir: "assets",
    emptyOutDir: true,
    sourcemap: false,
    minify: "esbuild",
    cssCodeSplit: true,
    rollupOptions: {
      input: {
        main: resolve(__vite_injected_original_dirname, "index.html"),
        snake: resolve(__vite_injected_original_dirname, "snake/index.html"),
        pong: resolve(__vite_injected_original_dirname, "pong/index.html"),
        flappy: resolve(__vite_injected_original_dirname, "flappy/index.html"),
        invaders: resolve(__vite_injected_original_dirname, "space-invaders/index.html"),
        breakout: resolve(__vite_injected_original_dirname, "breakout/index.html"),
        minesweeper: resolve(__vite_injected_original_dirname, "minesweeper/index.html"),
        game2048: resolve(__vite_injected_original_dirname, "2048/index.html"),
        leaderboard: resolve(__vite_injected_original_dirname, "leaderboard/index.html"),
        profile: resolve(__vite_injected_original_dirname, "profile/index.html"),
        lpfund: resolve(__vite_injected_original_dirname, "lp-fund/index.html")
      },
      output: {
        // Groupe les chunks partagés (wallet, api, header, footer) dans un seul bundle.
        // i18n.js sera rajouté quand une page l'importera — sinon Vite warn "entry not found".
        manualChunks(id) {
          if (!id.includes("/src/")) return;
          if (id.endsWith("/src/wallet.js") || id.endsWith("/src/api.js") || id.endsWith("/src/header.js") || id.endsWith("/src/footer.js")) {
            return "shared";
          }
        }
      }
    }
  },
  server: {
    port: 5173,
    open: "/",
    host: true
  },
  preview: {
    port: 4173,
    host: true
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvc2Vzc2lvbnMvam9sbHktcGVuc2l2ZS13b3puaWFrL21udC9zbmFrZS1iYWNrZW5kL2Zyb250ZW5kLXYyXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvc2Vzc2lvbnMvam9sbHktcGVuc2l2ZS13b3puaWFrL21udC9zbmFrZS1iYWNrZW5kL2Zyb250ZW5kLXYyL3ZpdGUuY29uZmlnLmpzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9zZXNzaW9ucy9qb2xseS1wZW5zaXZlLXdvem5pYWsvbW50L3NuYWtlLWJhY2tlbmQvZnJvbnRlbmQtdjIvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkZWZpbmVDb25maWcgfSBmcm9tICd2aXRlJztcbmltcG9ydCB7IHJlc29sdmUgfSBmcm9tICdwYXRoJztcblxuLy8gTXVsdGktcGFnZSBhcHAgXHUyMDE0IGNoYXF1ZSBlbnRyXHUwMEU5ZSA9IHVuZSBwYWdlIEhUTUwgZGlzdGluY3RlXG4vLyBCdWlsZCBvdXRwdXQ6IGRpc3QvaW5kZXguaHRtbCwgZGlzdC9zbmFrZS9pbmRleC5odG1sLCBkaXN0L3BvbmcvaW5kZXguaHRtbCwgZXRjLlxuLy8gU2hhcmVkIG1vZHVsZXMgKHNyYy8qKSBzb250IGF1dG8tYnVuZGxcdTAwRTlzIGV0IHBhcnRhZ1x1MDBFOXMgdmlhIGltcG9ydHMgRVNNLlxuXG5leHBvcnQgZGVmYXVsdCBkZWZpbmVDb25maWcoe1xuICByb290OiAnLicsXG4gIHB1YmxpY0RpcjogJ3B1YmxpYycsXG4gIGJhc2U6ICcvJyxcblxuICBidWlsZDoge1xuICAgIG91dERpcjogJ2Rpc3QnLFxuICAgIGFzc2V0c0RpcjogJ2Fzc2V0cycsXG4gICAgZW1wdHlPdXREaXI6IHRydWUsXG4gICAgc291cmNlbWFwOiBmYWxzZSxcbiAgICBtaW5pZnk6ICdlc2J1aWxkJyxcbiAgICBjc3NDb2RlU3BsaXQ6IHRydWUsXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgaW5wdXQ6IHtcbiAgICAgICAgbWFpbjogICAgICAgICByZXNvbHZlKF9fZGlybmFtZSwgJ2luZGV4Lmh0bWwnKSxcbiAgICAgICAgc25ha2U6ICAgICAgICByZXNvbHZlKF9fZGlybmFtZSwgJ3NuYWtlL2luZGV4Lmh0bWwnKSxcbiAgICAgICAgcG9uZzogICAgICAgICByZXNvbHZlKF9fZGlybmFtZSwgJ3BvbmcvaW5kZXguaHRtbCcpLFxuICAgICAgICBmbGFwcHk6ICAgICAgIHJlc29sdmUoX19kaXJuYW1lLCAnZmxhcHB5L2luZGV4Lmh0bWwnKSxcbiAgICAgICAgaW52YWRlcnM6ICAgICByZXNvbHZlKF9fZGlybmFtZSwgJ3NwYWNlLWludmFkZXJzL2luZGV4Lmh0bWwnKSxcbiAgICAgICAgYnJlYWtvdXQ6ICAgICByZXNvbHZlKF9fZGlybmFtZSwgJ2JyZWFrb3V0L2luZGV4Lmh0bWwnKSxcbiAgICAgICAgbWluZXN3ZWVwZXI6ICByZXNvbHZlKF9fZGlybmFtZSwgJ21pbmVzd2VlcGVyL2luZGV4Lmh0bWwnKSxcbiAgICAgICAgZ2FtZTIwNDg6ICAgICByZXNvbHZlKF9fZGlybmFtZSwgJzIwNDgvaW5kZXguaHRtbCcpLFxuICAgICAgICBsZWFkZXJib2FyZDogIHJlc29sdmUoX19kaXJuYW1lLCAnbGVhZGVyYm9hcmQvaW5kZXguaHRtbCcpLFxuICAgICAgICBwcm9maWxlOiAgICAgIHJlc29sdmUoX19kaXJuYW1lLCAncHJvZmlsZS9pbmRleC5odG1sJyksXG4gICAgICAgIGxwZnVuZDogICAgICAgcmVzb2x2ZShfX2Rpcm5hbWUsICdscC1mdW5kL2luZGV4Lmh0bWwnKVxuICAgICAgfSxcbiAgICAgIG91dHB1dDoge1xuICAgICAgICAvLyBHcm91cGUgbGVzIGNodW5rcyBwYXJ0YWdcdTAwRTlzICh3YWxsZXQsIGFwaSwgaGVhZGVyLCBmb290ZXIpIGRhbnMgdW4gc2V1bCBidW5kbGUuXG4gICAgICAgIC8vIGkxOG4uanMgc2VyYSByYWpvdXRcdTAwRTkgcXVhbmQgdW5lIHBhZ2UgbCdpbXBvcnRlcmEgXHUyMDE0IHNpbm9uIFZpdGUgd2FybiBcImVudHJ5IG5vdCBmb3VuZFwiLlxuICAgICAgICBtYW51YWxDaHVua3MoaWQpIHtcbiAgICAgICAgICBpZiAoIWlkLmluY2x1ZGVzKCcvc3JjLycpKSByZXR1cm47XG4gICAgICAgICAgaWYgKGlkLmVuZHNXaXRoKCcvc3JjL3dhbGxldC5qcycpIHx8XG4gICAgICAgICAgICAgIGlkLmVuZHNXaXRoKCcvc3JjL2FwaS5qcycpICAgIHx8XG4gICAgICAgICAgICAgIGlkLmVuZHNXaXRoKCcvc3JjL2hlYWRlci5qcycpIHx8XG4gICAgICAgICAgICAgIGlkLmVuZHNXaXRoKCcvc3JjL2Zvb3Rlci5qcycpKSB7XG4gICAgICAgICAgICByZXR1cm4gJ3NoYXJlZCc7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHNlcnZlcjoge1xuICAgIHBvcnQ6IDUxNzMsXG4gICAgb3BlbjogJy8nLFxuICAgIGhvc3Q6IHRydWVcbiAgfSxcblxuICBwcmV2aWV3OiB7XG4gICAgcG9ydDogNDE3MyxcbiAgICBob3N0OiB0cnVlXG4gIH1cbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF5VyxTQUFTLG9CQUFvQjtBQUN0WSxTQUFTLGVBQWU7QUFEeEIsSUFBTSxtQ0FBbUM7QUFPekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsTUFBTTtBQUFBLEVBQ04sV0FBVztBQUFBLEVBQ1gsTUFBTTtBQUFBLEVBRU4sT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsV0FBVztBQUFBLElBQ1gsYUFBYTtBQUFBLElBQ2IsV0FBVztBQUFBLElBQ1gsUUFBUTtBQUFBLElBQ1IsY0FBYztBQUFBLElBQ2QsZUFBZTtBQUFBLE1BQ2IsT0FBTztBQUFBLFFBQ0wsTUFBYyxRQUFRLGtDQUFXLFlBQVk7QUFBQSxRQUM3QyxPQUFjLFFBQVEsa0NBQVcsa0JBQWtCO0FBQUEsUUFDbkQsTUFBYyxRQUFRLGtDQUFXLGlCQUFpQjtBQUFBLFFBQ2xELFFBQWMsUUFBUSxrQ0FBVyxtQkFBbUI7QUFBQSxRQUNwRCxVQUFjLFFBQVEsa0NBQVcsMkJBQTJCO0FBQUEsUUFDNUQsVUFBYyxRQUFRLGtDQUFXLHFCQUFxQjtBQUFBLFFBQ3RELGFBQWMsUUFBUSxrQ0FBVyx3QkFBd0I7QUFBQSxRQUN6RCxVQUFjLFFBQVEsa0NBQVcsaUJBQWlCO0FBQUEsUUFDbEQsYUFBYyxRQUFRLGtDQUFXLHdCQUF3QjtBQUFBLFFBQ3pELFNBQWMsUUFBUSxrQ0FBVyxvQkFBb0I7QUFBQSxRQUNyRCxRQUFjLFFBQVEsa0NBQVcsb0JBQW9CO0FBQUEsTUFDdkQ7QUFBQSxNQUNBLFFBQVE7QUFBQTtBQUFBO0FBQUEsUUFHTixhQUFhLElBQUk7QUFDZixjQUFJLENBQUMsR0FBRyxTQUFTLE9BQU8sRUFBRztBQUMzQixjQUFJLEdBQUcsU0FBUyxnQkFBZ0IsS0FDNUIsR0FBRyxTQUFTLGFBQWEsS0FDekIsR0FBRyxTQUFTLGdCQUFnQixLQUM1QixHQUFHLFNBQVMsZ0JBQWdCLEdBQUc7QUFDakMsbUJBQU87QUFBQSxVQUNUO0FBQUEsUUFDRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBRUEsUUFBUTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLElBQ04sTUFBTTtBQUFBLEVBQ1I7QUFBQSxFQUVBLFNBQVM7QUFBQSxJQUNQLE1BQU07QUFBQSxJQUNOLE1BQU07QUFBQSxFQUNSO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K

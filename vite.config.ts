import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the built game also works when opened from a sub-folder
  // (and later inside the Capacitor native app wrapper).
  base: './',
  build: {
    chunkSizeWarningLimit: 2000, // Phaser itself is ~1.2 MB
  },
});

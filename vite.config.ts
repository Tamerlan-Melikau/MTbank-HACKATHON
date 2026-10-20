/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// base: './' — сборка работает из любого подкаталога (GitHub Pages: /<repo>/),
// а HashRouter не требует настройки сервера для глубоких ссылок.
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  build: {
    target: ['es2020', 'safari14', 'chrome90'],
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      // Push notification handlers (public/push-sw.js) run inside the
      // generated service worker.
      workbox: { importScripts: ['push-sw.js'] },
      manifest: {
        name: 'Profit Tracker',
        short_name: 'Profit Tracker',
        description: 'Track your arbitrage and optimize your cashflow',
        theme_color: '#0f0f1a',
        background_color: '#0f0f1a',
        display: 'standalone',
        scope: '/',
        start_url: '/',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      }
    })
  ],
  test: {
    // Gives tests a working localStorage on Node 25+ (see the file).
    setupFiles: ['./src/test/setupStorage.js', './src/test/setupDom.js'],
  },
})

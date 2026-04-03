import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const appVersion: string = JSON.parse(readFileSync('./package.json', 'utf-8')).version

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  base: process.env.VITE_BASE ?? './',
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        { src: 'node_modules/sql.js/dist/sql-wasm.wasm', dest: '' },
      ]
    }),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 't.SicView',
        short_name: 't.SicView',
        description: 'Offline ZEISS diagnostic archive parser — files never leave your device',
        theme_color: '#25283d',
        background_color: '#25283d',
        display: 'standalone',
        start_url: './',
        scope: './',
        icons: [{ src: '/icons/trilion-web.ico', sizes: 'any', purpose: 'any maskable' }]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,wasm,png,ico}'],
        runtimeCaching: [
          {
            urlPattern: /\/knowledge_base\/.+\.yaml$/,
            handler: 'CacheFirst',
            options: { cacheName: 'gomsic-kb-v1' }
          },
          {
            urlPattern: /\/sql-wasm\.wasm$/,
            handler: 'CacheFirst',
            options: { cacheName: 'gomsic-wasm-v1' }
          }
        ]
      }
    })
  ],
  optimizeDeps: { exclude: ['sql.js'] },
  worker: {
    format: 'es'
  }
})

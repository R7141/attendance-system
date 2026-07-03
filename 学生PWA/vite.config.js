import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png}'],
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/student\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'student-api',
              expiration: { maxEntries: 50, maxAgeSeconds: 300 },
            },
          },
          {
            urlPattern: /^https?:\/\/.*\/signin/i,
            handler: 'NetworkOnly',
            options: { cacheName: 'signin-api' },
          },
        ],
      },
      manifest: {
        name: '课堂签到 - 学生端',
        short_name: '学生签到',
        description: '课堂签到系统学生端',
        theme_color: '#1677ff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
    }),
  ],
  server: {
    host: '0.0.0.0',
    port: 5175,
    open: true,
    proxy: {
      '/student': { target: 'http://127.0.0.1:8080', changeOrigin: true },
      '/signin': { target: 'http://127.0.0.1:8080', changeOrigin: true },
    },
  },
});
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // HTTPS with a self-signed certificate: the headset reaches the dev server over the LAN, and WebXR
    // needs a secure context. VITE_HTTP=1 (npm run dev:http) serves plain HTTP instead: localhost is a
    // secure context anyway (WebGPU works), and tools that reject self-signed certificates can open it.
    ...(process.env.VITE_HTTP ? [] : [basicSsl()])
  ],
  server: {
        host: true,
        open: true,
    },
  // WebAssembly WebP encoder (materials/imageToWebp.js): loads its .wasm itself, must not be pre-bundled
  optimizeDeps: {
    exclude: ['@jsquash/webp']
  }
})

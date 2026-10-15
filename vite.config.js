import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import basicSsl from '@vitejs/plugin-basic-ssl'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(), 
    basicSsl()
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

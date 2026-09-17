import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/cascade/',
  plugins: [react()],
  test: { include: ['src/**/*.test.ts'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          topology: ['@xyflow/react'],
          telemetry: ['recharts'],
        },
      },
    },
  },
})

/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the site from /<repo>/; the deploy workflow sets VITE_BASE.
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  test: {
    // attic/ holds the previous build kept for reference; .reference/ holds third-party material.
    exclude: [...configDefaults.exclude, 'attic/**', '.reference/**'],
  },
})

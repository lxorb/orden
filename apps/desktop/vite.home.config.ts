import { renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { siteFiles } from './src/lib/showcase/src/site'

const OUT = resolve(import.meta.dirname, 'dist-home')
function servedAtRoot(): Plugin {
  return {
    name: 'orden-home-at-root',
    apply: 'build',
    closeBundle() {
      renameSync(join(OUT, 'home.html'), join(OUT, 'index.html'))
      for (const [name, text] of Object.entries(siteFiles())) writeFileSync(join(OUT, name), text)
    },
  }
}
export default defineConfig({
  plugins: [servedAtRoot()],
  publicDir: false,
  clearScreen: false,
  build: {
    target: 'esnext',
    outDir: OUT,
    emptyOutDir: true,
    assetsDir: 'home',
    rollupOptions: { input: { home: resolve(import.meta.dirname, 'home.html') } },
  },
})

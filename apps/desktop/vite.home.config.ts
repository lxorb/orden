import { renameSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import { PREVIEW_PATH, siteFiles } from './src/lib/showcase/src/site'

const HOME = resolve(import.meta.dirname, 'dist-home')
const PREVIEW = resolve(import.meta.dirname, 'dist-preview', PREVIEW_PATH.slice(1, -1))
function servedAt(out: string, files: boolean): Plugin {
  return {
    name: 'orden-home-at-root',
    apply: 'build',
    closeBundle() {
      renameSync(join(out, 'home.html'), join(out, 'index.html'))
      if (files) for (const [name, text] of Object.entries(siteFiles())) writeFileSync(join(out, name), text)
    },
  }
}
export default defineConfig(({ mode }) => {
  const preview = mode === 'site-preview'
  const out = preview ? PREVIEW : HOME
  return {
    base: preview ? PREVIEW_PATH : '/',
    plugins: [servedAt(out, !preview)],
    publicDir: false,
    clearScreen: false,
    build: {
      target: 'esnext',
      outDir: out,
      emptyOutDir: true,
      assetsDir: 'home',
      rollupOptions: { input: { home: resolve(import.meta.dirname, 'home.html') } },
    },
  }
})

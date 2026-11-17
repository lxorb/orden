import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defaultExclude, defineConfig } from 'vitest/config'
import { emojiOutlines } from './emoji-outlines'

const clocks = { hookTimeout: 30000, testTimeout: 30000 }

export default defineConfig({
  plugins: [svelte(), emojiOutlines()],
  define: {
    __EVEN_BUILD__: JSON.stringify('under test'),
    __EVEN_PLUGIN__: 'false',
    __DRIVEABLE__: 'true',
    __APP_VERSION__: JSON.stringify('under test'),
    __APP_COMMIT__: JSON.stringify('c0ffee1'),
    __CLAUDE_CODE__: 'true',
  },
  test: {
    fsModuleCache: true,
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          css: true,
          include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
          exclude: [...defaultExclude, '**/*.effect.test.ts'],
          environment: 'node',
          setupFiles: ['test/loads.ts', 'src/lib/backend-ports.ts'],
          ...clocks,
        },
      },
      {
        extends: true,
        resolve: { conditions: ['browser'] },
        test: {
          name: 'effects',
          include: ['src/**/*.effect.test.ts', 'test/**/*.effect.test.ts'],
          environment: 'jsdom',
          setupFiles: ['test/effects/jsdom-layout.ts', 'test/loads.ts', 'src/lib/backend-ports.ts'],
          ...clocks,
        },
      },
    ],
  },
})

import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defaultExclude, defineConfig } from 'vitest/config'
import { emojiOutlines } from './emoji-outlines'
import { dirOnWords } from './svelte-dir'
import { ORDEN_APPS } from './app-build'

const clocks = { hookTimeout: 30000, testTimeout: 30000 }
const APPS = ORDEN_APPS.filter((app) => app !== 'orden')
export default defineConfig({
  plugins: [svelte(), dirOnWords(), emojiOutlines()],
  define: {
    __ORDEN_BUILD__: JSON.stringify('under test'),
    __DRIVEABLE__: 'true',
    __APP_VERSION__: JSON.stringify('under test'),
    __ORDEN_RELEASE__: JSON.stringify(null),
    __RELEASE_NEWS__: '[]',
    __APP_COMMIT__: JSON.stringify('c0ffee1'),
    __CLAUDE_CODE__: 'true',
    __AI__: 'true',
    __ORDEN_APP__: JSON.stringify('orden'),
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
          exclude: [...defaultExclude, '**/*.effect.test.ts', ...APPS.map((app) => `**/*.${app}.test.ts`)],
          environment: 'node',
          setupFiles: ['test/loads.ts', 'src/lib/backend-ports.ts'],
          ...clocks,
        },
      },
      ...APPS.map((app) => ({
        extends: true as const,
        define: { __ORDEN_APP__: JSON.stringify(app), __AI__: 'false' },
        test: {
          name: app,
          css: true,
          include: [`src/**/*.${app}.test.ts`, `test/**/*.${app}.test.ts`],
          environment: 'node' as const,
          setupFiles: ['test/loads.ts', 'src/lib/backend-ports.ts'],
          ...clocks,
        },
      })),
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

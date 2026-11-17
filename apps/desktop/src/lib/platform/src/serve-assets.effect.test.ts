import { expect, test, vi } from 'vitest'
import { serveAssets } from './serve-assets'

test('when the asset worker takes over, a sound or a film given by its sources is loaded again', () => {
  const heard = new Map<string, () => void>()
  const kept: unknown[] = []
  vi.stubGlobal('navigator', {
    serviceWorker: {
      addEventListener: (kind: string, then: () => void) => heard.set(kind, then),
      register: () => Promise.resolve(),
      ready: Promise.resolve({ active: { postMessage: (said: unknown) => kept.push(said) } }),
    },
  })
  document.body.innerHTML =
    '<video><source src="/asset/Work/talk.mp4" type="video/mp4"></video><audio src="/asset/Work/a.mp3"></audio>'
  const loads = vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)

  serveAssets()
  heard.get('controllerchange')?.()

  expect(loads.mock.contexts).toContain(document.querySelector('video'))
  vi.unstubAllGlobals()
})

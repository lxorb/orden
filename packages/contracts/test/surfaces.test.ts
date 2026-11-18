import { expect, test } from 'vitest'
import { registerSurfaces, surfaceLoad, whenNoSurface } from '../src/api'

test('a surface nobody registered is refused, or handed to whatever a build says waits for it', async () => {
  await expect(surfaceLoad('time')).rejects.toThrow("no module has registered the surface 'time'")

  whenNoSurface((id) => Promise.resolve(`waiting for ${id}`))
  await expect(surfaceLoad('time')).resolves.toBe('waiting for time')

  const gone = registerSurfaces({ time: () => Promise.resolve('the time tab') })
  await expect(surfaceLoad('time')).resolves.toBe('the time tab')
  gone()
})

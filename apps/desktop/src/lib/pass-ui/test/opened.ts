import 'fake-indexeddb/auto'
import './no-device'

const { configurePass, pass } = await import('../../pass-sync/src/store.svelte')
export const FAST = { m: 64, t: 1, p: 1 }
export const PASSWORD = 'correct horse battery staple'
configurePass({ kdf: FAST, pinKdf: FAST })
export async function opened() {
  await pass.start()
  if (pass.state === 'new') await pass.setup(PASSWORD)
}
export { pass }

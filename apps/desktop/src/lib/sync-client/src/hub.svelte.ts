import { providePort } from '@orden/contracts'

providePort('hub.device', {
  deviceOf: async (account) => (await import('./runner.svelte')).runner.deviceOf(account),
  name: async () => (await import('../../collab/src/api')).deviceName('Browser'),
})
export { deviceId, hub } from '../../hub/src/api'

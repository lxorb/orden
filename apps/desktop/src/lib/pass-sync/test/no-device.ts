import { vi } from 'vitest'

vi.mock('../../platform/src/secrets', () => ({
  secretsGuarded: () => false,
  readSecret: () => Promise.resolve(null),
  writeSecret: () => Promise.resolve(),
  forgetSecret: () => Promise.resolve(),
}))
vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(false),
  deviceSays: () => Promise.resolve(false),
  deviceName: () => 'Touch ID',
}))

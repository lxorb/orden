import { beforeEach, vi } from 'vitest'

export const fake = {
  secrets: new Map<string, string>(),
  guarded: true,
  can: true,
  yes: true,
  asked: [] as string[],
}
beforeEach(() => {
  fake.secrets.clear()
  Object.assign(fake, { guarded: true, can: true, yes: true, asked: [] })
})
vi.mock('../../ai-providers/src/api', async (original) => ({
  ...(await original<typeof import('../../ai-providers/src/api')>()),
  keysAreGuarded: () => fake.guarded,
  readSecret: (id: string) => Promise.resolve(fake.secrets.get(id) ?? null),
  writeSecret: (id: string, secret: string) => {
    fake.secrets.set(id, secret)
    return Promise.resolve()
  },
  forgetKey: (id: string) => {
    fake.secrets.delete(id)
    return Promise.resolve()
  },
}))
vi.mock('../../protect/src/device', () => ({
  deviceCan: () => Promise.resolve(fake.can),
  deviceSays: (reason: string) => {
    fake.asked.push(reason)
    return Promise.resolve(fake.yes)
  },
  deviceName: () => 'Touch ID',
}))

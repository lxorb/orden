import { beforeEach, describe, expect, test, vi } from 'vitest'

/** The look for a new version where a package manager keeps the install: the version
 *  is found, and nothing is fetched, because the manager installs it. See
 *  src-tauri/src/package_manager.rs for which managers are known. */

const world = vi.hoisted(() => ({
  manager: null as string | null,
  version: '1.4.0',
  downloads: 0,
  closes: 0,
  asked: [] as string[],
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  isNative: true,
  invoke: (command: string) => {
    world.asked.push(command)
    if (command === 'install_manager') return Promise.resolve(world.manager)
    if (command === 'check_update') {
      return Promise.resolve({
        rid: 7,
        currentVersion: '1.3.0',
        version: world.version,
        rawJson: {},
      })
    }
    return Promise.resolve(null)
  },
}))

vi.mock('@tauri-apps/plugin-updater', () => ({
  Update: class {
    version: string
    constructor(found: { version: string }) {
      this.version = found.version
    }
    download() {
      world.downloads++
      return Promise.resolve()
    }
    close() {
      world.closes++
      return Promise.resolve()
    }
  },
}))

let updater: typeof import('./updater')

beforeEach(async () => {
  world.manager = null
  world.version = '1.4.0'
  world.downloads = 0
  world.closes = 0
  world.asked = []
  vi.resetModules()
  updater = await import('./updater')
})

describe('where a package manager keeps the install', () => {
  test('finds the version and fetches nothing', async () => {
    world.manager = 'scoop'

    expect(await updater.stageUpdate('stable')).toBe('1.4.0')
    expect(world.downloads).toBe(0)
    expect(world.closes).toBe(1)
    expect(updater.ready()).toBe(false)
    expect(updater.stagedVersion()).toBe(null)
    expect(updater.announcedVersion()).toBe('1.4.0')
  })

  test('answers nothing for the version it found already, and the next one again', async () => {
    world.manager = 'brew'
    await updater.stageUpdate('stable')

    expect(await updater.stageUpdate('stable')).toBe(null)

    world.version = '1.5.0'
    expect(await updater.stageUpdate('stable')).toBe('1.5.0')
  })

  test('asks which manager once', async () => {
    world.manager = 'apt'
    await updater.stageUpdate('stable')
    await updater.stageUpdate('stable')

    expect(world.asked.filter((command) => command === 'install_manager')).toHaveLength(1)
  })
})

describe('where the app updates itself', () => {
  test('downloads the update, as it always has', async () => {
    expect(await updater.stageUpdate('stable')).toBe('1.4.0')
    expect(world.downloads).toBe(1)
    expect(updater.stagedVersion()).toBe('1.4.0')
    expect(updater.announcedVersion()).toBe(null)
  })
})

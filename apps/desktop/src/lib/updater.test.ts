import { beforeEach, describe, expect, test, vi } from 'vitest'
import { GIVE_UP } from './parting'

/** The look for a new version where a package manager keeps the install: the version
 *  is found, and nothing is fetched, because the manager installs it. See
 *  src-tauri/src/package_manager.rs for which managers are known. */

const world = vi.hoisted(() => ({
  manager: null as string | null,
  version: '1.4.0',
  downloads: 0,
  closes: 0,
  asked: [] as string[],
  installs: 0,
  mayInstall: true,
  installFails: false,
  askedToInstall: [] as unknown[],
  systemUpdates: [] as unknown[],
  notUpdated: null as { refused: boolean; command: string | null; reason: string } | null,
  mayStop: true,
  relaunched: 0,
}))

vi.mock('./quitting/ask', () => ({ mayStop: () => Promise.resolve(world.mayStop) }))
vi.mock('@tauri-apps/plugin-process', () => ({
  relaunch: () => {
    world.relaunched++
    return Promise.resolve()
  },
}))

vi.mock('./tauri', () => ({
  isDesktop: true,
  isNative: true,
  invoke: (command: string, args?: unknown) => {
    world.asked.push(command)
    if (command === 'update_may_install') {
      world.askedToInstall.push(args)
      return Promise.resolve(world.mayInstall)
    }
    if (command === 'install_manager') return Promise.resolve(world.manager)
    if (command === 'system_update') {
      world.systemUpdates.push(args)
      // The crate's error, serialised: fields on what the promise is rejected with.
      const not = world.notUpdated
      return not ? Promise.reject(Object.assign(new Error(not.reason), not)) : Promise.resolve(null)
    }
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
    install() {
      world.installs++
      return world.installFails ? Promise.reject(new Error('refused')) : Promise.resolve()
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
  world.installs = 0
  world.mayInstall = true
  world.installFails = false
  world.askedToInstall = []
  world.systemUpdates = []
  world.notUpdated = null
  world.mayStop = true
  world.relaunched = 0
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

/** A `.deb` or an `.rpm`: the notice installs through PackageKit and restarts (#1147);
 *  see src-tauri/src/system_update.rs. */
describe('where the system updates the install', () => {
  test('is apt and dnf, and no other manager', () => {
    expect(
      ['apt', 'dnf', 'aur', 'flatpak', 'snap', 'nix', 'brew', null].map(updater.updatedBySystem),
    ).toEqual([true, true, false, false, false, false, false, false])
  })

  test('installs the version on the channel, then restarts', async () => {
    expect(await (await import('./system-update')).updateBySystem('1.4.0', 'unstable')).toBe(null)
    expect(world.systemUpdates).toEqual([{ channel: 'unstable', version: '1.4.0' }])
    expect(world.relaunched).toBe(1)
  })

  test('installs nothing when what runs may not stop', async () => {
    world.mayStop = false
    expect(await (await import('./system-update')).updateBySystem('1.4.0', 'stable')).toBe(null)
    expect(world.systemUpdates).toEqual([])
    expect(world.relaunched).toBe(0)
  })

  test('answers the command for a terminal where it could not, and stays', async () => {
    world.notUpdated = {
      refused: false,
      command: 'sudo dnf upgrade --refresh orden',
      reason: 'no PackageKit',
    }
    expect(await (await import('./system-update')).updateBySystem('1.4.0', 'stable')).toBe(
      'sudo dnf upgrade --refresh orden',
    )
    expect(world.relaunched).toBe(0)
  })

  test('says nothing when the password was turned down', async () => {
    world.notUpdated = { refused: true, command: null, reason: 'the password was not given' }
    expect(await (await import('./system-update')).updateBySystem('1.4.0', 'stable')).toBe(null)
    expect(world.relaunched).toBe(0)
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

/** On Windows the installer ends the process with every window in it, so the crate says
 *  whether this window may start it; see `update_may_install` in lifecycle.rs. */
describe('the installer on the way out', () => {
  test('a window told no leaves the update alone', async () => {
    await updater.stageUpdate('stable')
    world.mayInstall = false

    expect(await updater.installStaged(true)).toBe(false)
    expect(world.installs).toBe(0)
    expect(world.askedToInstall).toEqual([{ closing: true }])
  })

  test('a window told no tells the others to look', async () => {
    await updater.stageUpdate('stable')
    world.mayInstall = false
    let stop: () => void = () => undefined
    const heard = new Promise<void>((resolve) => {
      stop = updater.hearHandedOn(resolve)
    })

    await updater.installStaged(true)
    await heard
    stop()
  })

  test('an installer that did not start lets another window try', async () => {
    await updater.stageUpdate('stable')
    world.installFails = true

    expect(await updater.installStaged()).toBe(false)
    expect(world.asked).toContain('update_install_failed')
  })

  test('a window told yes runs it, once', async () => {
    await updater.stageUpdate('stable')

    expect(await updater.installStaged(true)).toBe(true)
    expect(await updater.installStaged(true)).toBe(false)
    expect(world.installs).toBe(1)
  })

  test('a restart asks as the whole app, not as a window closing', async () => {
    await updater.stageUpdate('stable')

    expect(await updater.installStaged()).toBe(true)
    expect(world.askedToInstall).toEqual([{ closing: false }])
  })
})

/** What a window does when another one is about to start the installer: its writes
 *  land, then the crate hears, and a disk that does not answer does not hold it up. */
describe('settling for another window s installer', () => {
  test('says so once what is owed has landed', async () => {
    let landed: () => void = () => undefined
    const owed = new Promise<void>((resolve) => (landed = resolve))

    const settling = updater.settledForInstaller(() => owed)
    await Promise.resolve()
    expect(world.asked).not.toContain('update_settled')

    landed()
    await settling
    expect(world.asked).toContain('update_settled')
  })

  test('says so anyway once it has waited as long as a window going does', async () => {
    vi.useFakeTimers()
    try {
      const settling = updater.settledForInstaller(() => new Promise(() => undefined))
      await vi.advanceTimersByTimeAsync(GIVE_UP - 1)
      expect(world.asked).not.toContain('update_settled')

      await vi.advanceTimersByTimeAsync(1)
      await settling
      expect(world.asked).toContain('update_settled')
    } finally {
      vi.useRealTimers()
    }
  })
})

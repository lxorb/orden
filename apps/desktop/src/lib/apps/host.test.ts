import type { AppFile, HostFrame, NotStarted, RelayToHost, View } from '@orden/online/apps'
import { describe, expect, test } from 'vitest'
import type { LinkWorld, Opened } from '../online/link'
import {
  applicationFiles,
  BYE,
  FIRST_VIEW,
  host,
  HostLink,
  type HostWorld,
  type Runner,
  type Said,
  type Speaking,
} from './host.svelte'

/** This computer as an application's host (issue 1063, steps 3 to 5; host.svelte.ts):
 *  which files it hosts, what it does with the holder's Start, Stop and Restart, its
 *  signalling and its view, and what it says back - with the crate and the relay played
 *  here. */

const GIMP: AppFile = {
  v: 1,
  host: 'device-laptop',
  run: { kind: 'installed', id: 'gimp.desktop', name: 'GIMP' },
}
const OTHER: AppFile = { ...GIMP, host: 'device-desktop' }

const tick = () => new Promise((settle) => setTimeout(settle, 0))

function world(
  files: Record<string, AppFile | string>,
  options: { serves?: boolean; cannot?: NotStarted | null } = {},
) {
  const said: HostFrame[] = []
  const links: { app: string; heard: (what: RelayToHost | Opened) => void; closed: boolean }[] = []
  const asked: string[] = []
  let tell: ((what: Said) => void) | null = null
  let why: Awaited<ReturnType<Runner['start']>> = null
  let paths = Object.keys(files)
  let changed: (() => void) | null = null

  const runner: Runner = {
    start(key, file, view, heard) {
      asked.push(
        `start ${key} ${file.run.kind === 'installed' ? file.run.id : file.run.path} ${view.width}`,
      )
      tell = heard
      if (why === null) heard({ state: 'running', code: null })
      return Promise.resolve(why)
    },
    watch(key) {
      asked.push(`watch ${key}`)
      return Promise.resolve(false)
    },
    stop(key) {
      asked.push(`stop ${key}`)
      tell?.({ state: 'stopped', code: null })
      return Promise.resolve()
    },
    async signal(key, data) {
      asked.push(`signal ${key} ${data}`)
      // An offer takes the crate a while to answer; a candidate after it waits for it.
      if (data.includes('offer')) await tick()
      asked.push(`signalled ${key}`)
      return data.includes('offer') ? '{"answer":"v=0"}' : null
    },
    view(key, view) {
      asked.push(`view ${key} ${view.width}x${view.height}@${view.dpr} ${view.hz}`)
      return Promise.resolve()
    },
  }
  const made: HostWorld = {
    device: () => Promise.resolve('device-laptop'),
    files: () => paths,
    read: (path) => {
      const one = files[path]
      return Promise.resolve(
        one === undefined ? null : typeof one === 'string' ? one : JSON.stringify(one),
      )
    },
    idOf: (path) => Promise.resolve(`id-${path.replace(/\W/g, '')}`),
    serves: () => Promise.resolve(options.serves ?? true),
    cannot: options.cannot ?? null,
    runner,
    link: (app, heard): Speaking => {
      const link = { app, heard, closed: false }
      links.push(link)
      return {
        open: () => undefined,
        close: () => {
          link.closed = true
        },
        say: (frame) => {
          said.push(frame)
          return true
        },
      }
    },
  }
  const stop = host(made, (again) => {
    changed = again
    return () => {
      changed = null
    }
  })
  return {
    said,
    links,
    asked,
    stop,
    exits: (code: number) => tell?.({ state: 'exited', code }),
    refuses: (reason: NonNullable<typeof why>) => {
      why = reason
    },
    remove: (path: string) => {
      paths = paths.filter((one) => one !== path)
      changed?.()
    },
  }
}

const VIEW: View = { width: 1600, height: 900, dpr: 2, hz: 120 }

describe('an application’s host', () => {
  test('hosts the files that name this device, and no other, without starting them', async () => {
    const here = world({
      '/s/GIMP.application': GIMP,
      '/s/Other.application': OTHER,
      '/s/Bad.application': 'nope',
    })
    await tick()
    expect(here.links.map((one) => one.app)).toEqual(['id-sGIMPapplication'])
    expect(here.asked).toEqual(['watch id-sGIMPapplication'])

    // Once the socket is open, the relay is told where it stands: not running.
    here.links[0]?.heard({ t: 'open' })
    expect(here.said).toEqual([{ t: 'state', state: 'stopped' }])
  })

  test('makes no socket to an account that serves no applications', async () => {
    const here = world({ '/s/GIMP.application': GIMP }, { serves: false })
    await tick()
    expect(here.links).toEqual([])
    expect(here.asked).toEqual([])
  })

  test('a computer that cannot run one says why before Start, and Start asks nothing of the crate', async () => {
    const here = world({ '/s/GIMP.application': GIMP }, { cannot: 'isolation' })
    await tick()
    const heard = here.links[0]?.heard
    heard?.({ t: 'open' })
    expect(here.said).toEqual([{ t: 'state', state: 'stopped', why: 'isolation' }])
    heard?.({ t: 'run', what: 'start' })
    await tick()
    expect(here.said.at(-1)).toEqual({ t: 'state', state: 'stopped', why: 'isolation' })
    expect(here.asked.filter((one) => one.startsWith('start'))).toEqual([])
  })

  test('the holder’s Start runs it at the holder’s view, and says so', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    const heard = here.links[0]?.heard
    heard?.({ t: 'view', view: VIEW })
    heard?.({ t: 'run', what: 'start' })
    await tick()
    expect(here.asked).toContain('start id-sGIMPapplication gimp.desktop 1600')
    expect(here.said).toEqual([
      { t: 'state', state: 'starting' },
      { t: 'state', state: 'running' },
    ])

    here.exits(3)
    expect(here.said.at(-1)).toEqual({ t: 'state', state: 'exited', code: 3 })
  })

  test('a start the crate refused is said with its reason', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    here.refuses('isolation')
    here.links[0]?.heard({ t: 'run', what: 'start' })
    await tick()
    expect(here.said.at(-1)).toEqual({ t: 'state', state: 'stopped', why: 'isolation' })
  })

  test('Restart stops it and starts it again once it has stopped', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    const heard = here.links[0]?.heard
    heard?.({ t: 'run', what: 'start' })
    await tick()
    heard?.({ t: 'run', what: 'restart' })
    await tick()
    expect(here.asked.filter((one) => !one.startsWith('watch'))).toEqual([
      `start id-sGIMPapplication gimp.desktop ${FIRST_VIEW.width}`,
      'stop id-sGIMPapplication',
      `start id-sGIMPapplication gimp.desktop ${FIRST_VIEW.width}`,
    ])
    expect(here.said.at(-1)).toEqual({ t: 'state', state: 'running' })
  })

  test('its file going stops it; hosting stopping leaves it running', async () => {
    const here = world({ '/s/GIMP.application': GIMP, '/s/Two.application': GIMP })
    await tick()
    here.remove('/s/GIMP.application')
    await tick()
    expect(here.links[0]?.closed).toBe(true)
    expect(here.asked).toContain('stop id-sGIMPapplication')

    here.stop()
    expect(here.links[1]?.closed).toBe(true)
    expect(here.asked).not.toContain('stop id-sTwoapplication')
  })
})

describe('an application’s size', () => {
  test('follows the holder’s view while it runs, and is started at the last one', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    const heard = here.links[0]?.heard
    heard?.({ t: 'view', view: VIEW })
    expect(here.asked.filter((one) => one.startsWith('view'))).toEqual([])
    heard?.({ t: 'run', what: 'start' })
    await tick()
    expect(here.asked).toContain('start id-sGIMPapplication gimp.desktop 1600')

    // Resized, then taken over by a device with another screen.
    heard?.({ t: 'view', view: { ...VIEW, width: 1200 } })
    heard?.({ t: 'viewer', device: 'device-phone', name: 'Phone' })
    heard?.({ t: 'view', view: { width: 400, height: 800, dpr: 3, hz: 60 } })
    expect(here.asked.filter((one) => one.startsWith('view'))).toEqual([
      'view id-sGIMPapplication 1200x900@2 120',
      'view id-sGIMPapplication 400x800@3 60',
    ])
  })
})

describe('an application’s picture', () => {
  test('the holder’s signalling goes to the crate, and its answer back', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    const heard = here.links[0]?.heard
    heard?.({ t: 'viewer', device: 'device-phone', name: 'Phone' })
    heard?.({ t: 'signal', data: '{"offer":"v=0"}' })
    heard?.({ t: 'signal', data: '{"candidate":{"candidate":""}}' })
    await tick()
    await tick()
    expect(here.asked.filter((one) => one.startsWith('signal'))).toEqual([
      'signal id-sGIMPapplication {"offer":"v=0"}',
      'signalled id-sGIMPapplication',
      'signal id-sGIMPapplication {"candidate":{"candidate":""}}',
      'signalled id-sGIMPapplication',
    ])
    // Only the answer is said back; a candidate has nothing to say.
    expect(here.said).toEqual([{ t: 'signal', data: '{"answer":"v=0"}' }])
  })

  test('another holder, or none, ends the picture the last one had', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    const heard = here.links[0]?.heard
    const byes = () => here.asked.filter((one) => one === `signal id-sGIMPapplication ${BYE}`)
    heard?.({ t: 'viewer', device: 'device-phone', name: 'Phone' })
    heard?.({ t: 'viewer', device: 'device-phone', name: 'Phone' })
    await tick()
    expect(byes()).toHaveLength(0)
    heard?.({ t: 'viewer', device: 'device-tablet', name: 'Tablet' })
    await tick()
    expect(byes()).toHaveLength(1)
    heard?.({ t: 'viewer', device: null, name: '' })
    await tick()
    expect(byes()).toHaveLength(2)
  })

  test('the relay’s socket dropping leaves the picture; hosting ending ends it', async () => {
    const here = world({ '/s/GIMP.application': GIMP })
    await tick()
    here.links[0]?.heard({ t: 'viewer', device: 'device-phone', name: 'Phone' })
    here.links[0]?.heard({ t: 'dropped' })
    await tick()
    expect(here.asked).not.toContain(`signal id-sGIMPapplication ${BYE}`)
    here.stop()
    await tick()
    expect(here.asked).toContain(`signal id-sGIMPapplication ${BYE}`)
  })
})

describe('the host’s socket', () => {
  test('names its role beside the token and the device', async () => {
    const offered: string[][] = []
    const linkWorld: LinkWorld = {
      base: 'https://sync.example',
      token: () => 'token',
      device: () => Promise.resolve('device-laptop'),
      socket: (_url, protocols) => {
        offered.push(protocols)
        return { open: false, buffered: 0, send: () => undefined, close: () => undefined }
      },
      after: () => () => undefined,
      now: () => 0,
      hidden: () => false,
      watch: () => () => undefined,
    }
    const link = new HostLink('app-1', linkWorld, () => undefined)
    link.open()
    await tick()
    expect(offered[0]).toEqual(['nib.token.token', 'nib.device.device-laptop', 'nib.role.host'])
    link.close()
  })
})

test('every application file of a tree, however deep', () => {
  const tree = {
    path: '/s',
    is_dir: true,
    children: [
      { path: '/s/GIMP.application', is_dir: false },
      { path: '/s/Plan.md', is_dir: false },
      {
        path: '/s/tools',
        is_dir: true,
        children: [{ path: '/s/tools/Blender.APPLICATION', is_dir: false }],
      },
    ],
  }
  expect(applicationFiles(tree)).toEqual(['/s/GIMP.application', '/s/tools/Blender.APPLICATION'])
  expect(applicationFiles(null)).toEqual([])
})

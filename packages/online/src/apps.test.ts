import { describe, expect, it } from 'vitest'
import {
  type AppFile,
  catalogueOf,
  fromHostOf,
  iceServersOf,
  inputText,
  MOST_ICON,
  MOST_INSTALLED,
  appFileOf,
  appFileText,
  appSocketPath,
  hostFrameOf,
  MOST_SIGNAL,
  type RelayToHost,
  type RelayToViewer,
  toHostOf,
  toHostText,
  toViewerOf,
  type ViewerFrame,
  viewerFrameOf,
  viewOf,
} from './apps'

const view = { width: 1440, height: 900, dpr: 2, hz: 120 }

describe('an application’s socket', () => {
  it.each<ViewerFrame>([
    { t: 'hello' },
    { t: 'hello', hold: true, view },
    { t: 'take' },
    { t: 'leave' },
    { t: 'signal', data: '{"sdp":"v=0"}' },
    { t: 'view', view },
    { t: 'run', what: 'restart' },
  ])('reads back what a viewer sent: %j', (one) => {
    expect(viewerFrameOf(JSON.stringify(one))).toEqual(one)
  })

  it.each<RelayToViewer>([
    { t: 'held', by: 'Laptop', since: 1, taken: true },
    { t: 'hold' },
    { t: 'host', up: false },
    { t: 'state', state: 'exited', code: 1 },
    { t: 'state', state: 'running' },
    { t: 'state', state: 'stopped', why: 'isolation' },
    { t: 'state', state: 'exited', code: null, why: 'failed' },
    { t: 'refused', error: 'gone' },
  ])('reads back what the relay told a viewer: %j', (one) => {
    expect(toViewerOf(JSON.stringify(one))).toEqual(one)
  })

  it.each<RelayToHost>([
    { t: 'viewer', device: 'd_1', name: 'Phone' },
    { t: 'viewer', device: null, name: '' },
    { t: 'view', view },
    { t: 'run', what: 'stop' },
  ])('reads back what the relay told the host: %j', (one) => {
    expect(toHostOf(JSON.stringify(one))).toEqual(one)
  })

  it('reads the host’s frames, and drops what does not check', () => {
    expect(hostFrameOf('{"t":"host"}')).toEqual({ t: 'host' })
    expect(hostFrameOf('{"t":"state","state":"melting"}')).toBeNull()
    expect(viewerFrameOf('{"t":"run","what":"format c:"}')).toBeNull()
    expect(
      viewerFrameOf(JSON.stringify({ t: 'signal', data: 'x'.repeat(MOST_SIGNAL + 1) })),
    ).toBeNull()
    expect(viewerFrameOf('{"t":"hello","view":{"width":0,"height":1,"dpr":1,"hz":60}}')).toBeNull()
    expect(viewerFrameOf('not json')).toBeNull()
  })

  it('bounds a view to what a screen can be', () => {
    expect(viewOf(view)).toEqual(view)
    expect(viewOf({ ...view, dpr: 9 })).toBeNull()
    expect(viewOf({ ...view, hz: Number.NaN })).toBeNull()
  })

  it('names the socket by the file id, escaped', () => {
    expect(appSocketPath('a/b')).toBe('/v2/apps/a%2Fb/socket')
  })
})

describe('an application’s file', () => {
  it('reads back what it wrote, both kinds of run', () => {
    const installed = {
      v: 1,
      host: 'd_1',
      run: { kind: 'installed', id: 'org.gimp.GIMP', name: 'GIMP' },
    } satisfies AppFile
    const path: AppFile = {
      v: 1,
      host: 'd_1',
      run: { kind: 'path', path: '/usr/bin/xclock', args: ['-digital'], cwd: null },
    }
    expect(appFileOf(appFileText(installed))).toEqual(installed)
    expect(appFileOf(appFileText(path))).toEqual(path)
  })

  it('is read strictly: anything else is not an application', () => {
    expect(appFileOf('')).toBeNull()
    expect(appFileOf('{"v":2,"host":"d","run":{"kind":"path","path":"/x"}}')).toBeNull()
    expect(appFileOf('{"v":1,"host":"","run":{"kind":"path","path":"/x"}}')).toBeNull()
    expect(appFileOf('{"v":1,"host":"d","run":{"kind":"path","path":"/x","args":[1]}}')).toBeNull()
    expect(appFileOf('{"v":1,"host":"d","run":{"kind":"shell","cmd":"rm"}}')).toBeNull()
    expect(appFileOf('{"v":1,"host":"d","run":{"kind":"path","path":"/x"}}')).toEqual({
      v: 1,
      host: 'd',
      run: { kind: 'path', path: '/x', args: [], cwd: null },
    })
  })
})

describe('a reason a host did not start it', () => {
  it('is dropped, and the frame kept, when this side does not know it', () => {
    expect(toViewerOf('{"t":"state","state":"stopped","why":"later"}')).toEqual({
      t: 'state',
      state: 'stopped',
    })
    expect(hostFrameOf('{"t":"state","state":"stopped","why":"display"}')).toEqual({
      t: 'state',
      state: 'stopped',
      why: 'display',
    })
  })
})

describe('a host’s catalogue', () => {
  it('keeps what checks, the first of an id, and an icon only when it is a small picture', () => {
    const png = 'data:image/png;base64,iVBORw0KGgo='
    expect(
      catalogueOf([
        { id: 'gimp.desktop', name: 'GIMP', icon: png },
        { id: 'gimp.desktop', name: 'Again' },
        { id: 'x.desktop', name: 'X', icon: 'data:text/html;base64,PHA+' },
        { id: 'big.desktop', name: 'Big', icon: `data:image/png;base64,${'A'.repeat(MOST_ICON)}` },
        { id: '', name: 'No id' },
        'not one',
      ]),
    ).toEqual([
      { id: 'gimp.desktop', name: 'GIMP', icon: png },
      { id: 'x.desktop', name: 'X' },
      { id: 'big.desktop', name: 'Big' },
    ])
    expect(catalogueOf({ apps: [] })).toBeNull()
  })

  it('lists at most MOST_INSTALLED', () => {
    const many = Array.from({ length: MOST_INSTALLED + 5 }, (_, at) => ({
      id: `${at}`,
      name: `${at}`,
    }))
    expect(catalogueOf(many)).toHaveLength(MOST_INSTALLED)
  })
})

describe('the picture’s signalling', () => {
  it('says the viewer’s offer, candidates and goodbye as the host’s crate reads them', () => {
    expect(toHostText({ offer: 'v=0' })).toBe('{"offer":"v=0"}')
    expect(
      toHostText({
        candidate: { candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host', sdpMid: '0' },
      }),
    ).toBe('{"candidate":{"candidate":"candidate:1 1 udp 1 1.2.3.4 5 typ host","sdpMid":"0"}}')
    expect(toHostText({ bye: true })).toBe('{"bye":true}')
  })

  it('reads the host’s answer and why it has no picture, a reason it does not know as none', () => {
    expect(fromHostOf('{"answer":"v=0"}')).toEqual({ answer: 'v=0' })
    expect(fromHostOf('{"cannot":"encoder"}')).toEqual({ cannot: 'encoder' })
    expect(fromHostOf('{"cannot":"gpu"}')).toEqual({ cannot: null })
    expect(fromHostOf('{"answer":3}')).toBeNull()
    expect(fromHostOf('not json')).toBeNull()
  })
})

describe('the holder’s input', () => {
  it('goes as the JSON the host’s crate reads, tagged by what it is', () => {
    expect(inputText({ t: 'move', x: 10, y: 20 })).toBe('{"t":"move","x":10,"y":20}')
    expect(inputText({ t: 'key', key: 'a', code: 'KeyA', down: true })).toBe(
      '{"t":"key","key":"a","code":"KeyA","down":true}',
    )
  })
})

describe('the servers a viewer is handed', () => {
  it('keeps STUN and TURN addresses, a list or one, with a TURN server’s credentials', () => {
    expect(
      iceServersOf([
        { urls: 'stun:stun.cloudflare.com:3478' },
        {
          urls: ['turn:turn.example:3478?transport=udp', 'https://x'],
          username: 'u',
          credential: 'c',
        },
        { urls: ['ftp://x'] },
        'nope',
      ]),
    ).toEqual([
      { urls: ['stun:stun.cloudflare.com:3478'] },
      { urls: ['turn:turn.example:3478?transport=udp'], username: 'u', credential: 'c' },
    ])
    expect(iceServersOf({ urls: 'turns:turn.example:443' })).toEqual([
      { urls: ['turns:turn.example:443'] },
    ])
    expect(iceServersOf(null)).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  appSocketPath,
  hostFrameOf,
  MOST_SIGNAL,
  type RelayToHost,
  type RelayToViewer,
  toHostOf,
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

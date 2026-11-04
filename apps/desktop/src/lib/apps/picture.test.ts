import { describe, expect, test } from 'vitest'
import { AGAIN_AFTER, Picture, type PeerWorld, SHOWN_WITHIN } from './picture.svelte'

/** An application's picture in its tab (issue 1063, step 4; picture.svelte.ts): what it
 *  offers, what it does with the host's answer, and when it ends and tries again - with
 *  the engine's connection and the clock played here. */

const tick = () => new Promise((settle) => setTimeout(settle, 0))

class FakePeer {
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: { sdp: string } | null = null
  remote: string | null = null
  closed = false
  wants: string[] = []
  ontrack: ((event: { streams: unknown[]; track: unknown }) => void) | null = null
  onicecandidate: ((event: { candidate: unknown }) => void) | null = null
  onconnectionstatechange: (() => void) | null = null
  channel = {
    onopen: null as (() => void) | null,
    readyState: 'connecting' as RTCDataChannelState,
    sent: [] as string[],
    send(data: string) {
      this.sent.push(data)
    },
  }

  addTransceiver(kind: string, init: { direction: string }) {
    this.wants.push(`${kind} ${init.direction}`)
  }
  createDataChannel(label: string) {
    this.wants.push(`channel ${label}`)
    return this.channel
  }
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'v=0 offer' })
  }
  setLocalDescription(offer: { sdp: string }) {
    this.localDescription = offer
    return Promise.resolve()
  }
  setRemoteDescription(answer: { sdp: string }) {
    this.remote = answer.sdp
    return Promise.resolve()
  }
  close() {
    this.closed = true
  }
  becomes(state: RTCPeerConnectionState) {
    this.connectionState = state
    this.onconnectionstatechange?.()
  }
}

function world(engine = true) {
  const peers: FakePeer[] = []
  const timers: { at: number; run: () => void; gone: boolean }[] = []
  const said: string[] = []
  const made: PeerWorld = {
    make: () => {
      if (!engine) return null
      const peer = new FakePeer()
      peers.push(peer)
      return peer as unknown as RTCPeerConnection
    },
    after: (ms, run) => {
      const timer = { at: ms, run, gone: false }
      timers.push(timer)
      return () => {
        timer.gone = true
      }
    },
  }
  const picture = new Picture((data) => said.push(data), made)
  /** Runs the timers due after `ms`, as the clock would. */
  const wait = (ms: number) => {
    for (const timer of timers.splice(0)) {
      if (timer.gone) continue
      if (timer.at <= ms) timer.run()
      else timers.push(timer)
    }
  }
  return { picture, peers, said, wait }
}

describe('an application’s picture', () => {
  test('offers a receive-only video and the input channel, and trickles its candidates', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    expect(here.peers[0]?.wants).toEqual(['video recvonly', 'channel input'])
    expect(here.said).toEqual(['{"offer":"v=0 offer"}'])
    expect(here.picture.status).toEqual({ is: 'connecting' })

    here.peers[0]?.onicecandidate?.({
      candidate: {
        candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
      },
    })
    here.peers[0]?.onicecandidate?.({ candidate: null })
    expect(here.said.at(-1)).toBe(
      '{"candidate":{"candidate":"candidate:1 1 udp 1 1.2.3.4 5 typ host","sdpMid":"0","sdpMLineIndex":0}}',
    )
    expect(here.said).toHaveLength(2)
  })

  test('takes the host’s answer and shows the picture once connected', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    here.picture.heard('{"answer":"v=0 answer"}')
    expect(here.peers[0]?.remote).toBe('v=0 answer')
    const stream = { id: 'stream' }
    here.peers[0]?.ontrack?.({ streams: [stream], track: {} })
    here.peers[0]?.becomes('connected')
    expect(here.picture.status).toEqual({ is: 'showing' })
    expect(here.picture.stream).toBe(stream)

    // Showing in time, the deadline does nothing.
    here.wait(SHOWN_WITHIN)
    expect(here.picture.status).toEqual({ is: 'showing' })
  })

  test('says why the host has none, and does not ask again until wanted afresh', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    here.picture.heard('{"cannot":"encoder"}')
    expect(here.picture.status).toEqual({ is: 'cannot', why: 'encoder' })
    expect(here.peers[0]?.closed).toBe(true)
    here.wait(AGAIN_AFTER)
    expect(here.peers).toHaveLength(1)

    here.picture.want(false)
    here.picture.want(true)
    await tick()
    expect(here.peers).toHaveLength(2)
  })

  test('a connection that fails, or is never answered, is tried again while wanted', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    here.peers[0]?.becomes('failed')
    expect(here.picture.status).toEqual({ is: 'lost' })
    here.wait(AGAIN_AFTER)
    await tick()
    expect(here.peers).toHaveLength(2)
    expect(here.picture.status).toEqual({ is: 'connecting' })

    // This offer the relay lost: never answered, it counts as failed in the end.
    here.wait(SHOWN_WITHIN)
    expect(here.picture.status).toEqual({ is: 'lost' })
    here.picture.want(false)
    here.wait(AGAIN_AFTER)
    expect(here.peers).toHaveLength(2)
  })

  test('not wanted, it ends and tells the host', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    here.picture.want(false)
    expect(here.peers[0]?.closed).toBe(true)
    expect(here.said.at(-1)).toBe('{"bye":true}')
    expect(here.picture.status).toEqual({ is: 'off' })

    // What the old connection says after is not heard.
    here.peers[0]?.becomes('connected')
    expect(here.picture.status).toEqual({ is: 'off' })
  })

  test('sends what the holder does over the channel once it is open, and nothing before', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    const channel = here.peers[0]?.channel
    here.picture.input({ t: 'move', x: 1, y: 2 })
    expect(channel?.sent).toEqual([])
    if (channel) channel.readyState = 'open'
    channel?.onopen?.()
    here.picture.input({ t: 'move', x: 3, y: 4 })
    expect(channel?.sent).toEqual(['{"t":"move","x":3,"y":4}'])

    here.picture.want(false)
    here.picture.input({ t: 'move', x: 5, y: 6 })
    expect(channel?.sent).toHaveLength(1)
  })

  test('an engine without WebRTC says so', () => {
    const here = world(false)
    here.picture.want(true)
    expect(here.picture.status).toEqual({ is: 'unsupported' })
  })
})

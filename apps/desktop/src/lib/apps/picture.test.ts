import { describe, expect, test } from 'vitest'
import { AGAIN_AFTER, Picture, type PeerWorld, SHOWN_WITHIN } from './picture.svelte'

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
    onmessage: null as ((event: { data: unknown }) => void) | null,
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
  getStats() {
    return Promise.resolve(
      new Map([['v', { id: 'v', type: 'inbound-rtp', kind: 'video', frameWidth: 640 }]]),
    )
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
  const offered: unknown[] = []
  const copied: string[] = []
  const clock = { now: 1000 }
  const made: PeerWorld = {
    servers: () => Promise.resolve([{ urls: ['stun:stun.example:3478'] }]),
    make: (servers) => {
      offered.push(servers)
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
    copy: (text) => copied.push(text),
    now: () => clock.now,
  }
  const picture = new Picture((data) => said.push(data), made)
  const wait = (ms: number) => {
    for (const timer of timers.splice(0)) {
      if (timer.gone) continue
      if (timer.at <= ms) timer.run()
      else timers.push(timer)
    }
  }
  return { picture, peers, said, wait, offered, copied, clock }
}

describe('an application’s picture', () => {
  test('offers a receive-only video and the input channel, and trickles its candidates', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    expect(here.peers[0]?.wants).toEqual(['video recvonly', 'audio recvonly', 'channel input'])
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
    expect(here.picture.status).toEqual({ is: 'lost' })

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
    expect(channel?.sent).toEqual(['{"t":"share","clipboard":false}', '{"t":"move","x":3,"y":4}'])

    here.picture.want(false)
    here.picture.input({ t: 'move', x: 5, y: 6 })
    expect(channel?.sent).toHaveLength(2)
  })

  test('an engine without WebRTC says so', async () => {
    const here = world(false)
    here.picture.want(true)
    await tick()
    expect(here.picture.status).toEqual({ is: 'unsupported' })
  })

  test('connects through the servers the account handed out', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    expect(here.offered).toEqual([[{ urls: ['stun:stun.example:3478'] }]])
  })

  test('wanted, then not, then again while the servers are asked for, makes one connection', async () => {
    const here = world()
    here.picture.want(true)
    here.picture.want(false)
    here.picture.want(true)
    await tick()
    await tick()
    expect(here.peers).toHaveLength(1)
    expect(here.said.filter((one) => one.includes('offer'))).toHaveLength(1)
  })

  test('draws the application’s pointer as its host says it, until the picture ends', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    const channel = here.peers[0]?.channel
    const png = 'data:image/png;base64,iVBORw0KGgo='
    channel?.onmessage?.({ data: JSON.stringify({ t: 'pointer', png, x: 1, y: 2 }) })
    expect(here.picture.pointer).toEqual({ t: 'pointer', png, x: 1, y: 2 })
    channel?.onmessage?.({ data: '{"t":"pointer","png":"javascript:alert(1)","x":0,"y":0}' })
    channel?.onmessage?.({ data: 'nope' })
    expect(here.picture.pointer).toEqual({ t: 'pointer', png, x: 1, y: 2 })
    channel?.onmessage?.({ data: '{"t":"pointer","hidden":true}' })
    expect(here.picture.pointer).toEqual({ t: 'pointer', hidden: true })

    here.picture.want(false)
    expect(here.picture.pointer).toBeNull()
    channel?.onmessage?.({ data: JSON.stringify({ t: 'pointer', png, x: 1, y: 2 }) })
    expect(here.picture.pointer).toBeNull()
  })

  test('plays the host’s sound apart from its picture', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    const picture = { id: 'picture' }
    const sound = { id: 'sound' }
    here.peers[0]?.ontrack?.({ streams: [picture], track: { kind: 'video' } })
    here.peers[0]?.ontrack?.({ streams: [sound], track: { kind: 'audio' } })
    expect(here.picture.stream).toBe(picture)
    expect(here.picture.sound).toBe(sound)
    here.picture.want(false)
    expect(here.picture.sound).toBeNull()
  })

  test('the clipboard goes both ways only while it is shared, and the host is told', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    const channel = here.peers[0]?.channel
    if (channel) channel.readyState = 'open'
    channel?.onopen?.()
    expect(channel?.sent).toEqual(['{"t":"share","clipboard":false}'])

    here.picture.paste('secret')
    channel?.onmessage?.({ data: '{"t":"clipboard","text":"from it"}' })
    expect(here.copied).toEqual([])
    expect(channel?.sent).toHaveLength(1)

    here.picture.share(true)
    here.picture.paste('mine')
    channel?.onmessage?.({ data: '{"t":"clipboard","text":"from it"}' })
    expect(channel?.sent.slice(1)).toEqual([
      '{"t":"share","clipboard":true}',
      '{"t":"clipboard","text":"mine"}',
    ])
    expect(here.copied).toEqual(['from it'])

    here.picture.want(false)
    here.picture.want(true)
    await tick()
    const again = here.peers[1]?.channel
    if (again) again.readyState = 'open'
    again?.onopen?.()
    expect(again?.sent).toEqual(['{"t":"share","clipboard":true}'])
  })

  test('measures once a second while the overlay is open: a ping, the engine, glass to glass', async () => {
    const here = world()
    here.picture.want(true)
    await tick()
    const channel = here.peers[0]?.channel
    if (channel) channel.readyState = 'open'
    channel?.onopen?.()
    const release = here.picture.hold()
    const other = here.picture.hold()
    await tick()
    expect(channel?.sent.at(-1)).toBe('{"t":"ping","at":1000}')
    expect(here.picture.stats?.width).toBe(640)

    here.clock.now = 1020
    channel?.onmessage?.({
      data: '{"t":"pong","at":1000,"began":4000,"now":5010,"encoder":"libvpx","hardware":false,"usage":{"cpu":5,"memory":2048}}',
    })
    expect(here.picture.usage).toEqual({ cpu: 5, memory: 2048 })
    expect(here.picture.encoder).toEqual({ name: 'libvpx', hardware: false })
    here.clock.now = 2040
    here.picture.presented(180_000, 2035)
    here.wait(1000)
    expect(here.picture.latency).toBeCloseTo(35)

    release()
    release()
    expect(here.picture.stats).not.toBeNull()
    other()
    expect(here.picture.stats).toBeNull()
    expect(here.picture.latency).toBeNull()
  })
})

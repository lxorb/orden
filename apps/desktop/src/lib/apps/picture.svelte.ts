/** An application's picture in its tab (issue 1063, step 4; docs/apps.md): the
 *  engine's own `RTCPeerConnection`, receive-only, offering a video, its sound (step 6)
 *  and the data channel that input takes, to the host the relay passes its signalling
 *  to. The picture itself comes from the host directly, never through the relay; so do
 *  the application's pointer and, while this device shares it, its clipboard.
 *
 *  Wanted while this device holds the application and it runs on a host that is there;
 *  not wanted, the connection ends and the host is told. A connection that fails is
 *  tried again after a while, as long as it is wanted; a host that says why it has no
 *  picture is not asked again until the picture is wanted afresh. */

import {
  FALLBACK_ICE,
  fromHostOf,
  fromPictureOf,
  ICE_PATH,
  type IceServer,
  iceServersOf,
  type InputEvent,
  inputText,
  MOST_CLIPBOARD,
  type NoPicture,
  type PointerShape,
  type Usage,
  toHostText,
  type ToHost,
} from '@orden/online/apps'
import {
  type Clock,
  clockOf,
  type Counts,
  middle,
  seenAt,
  type StreamStats,
  streamStats,
} from './stats'

export type PictureStatus =
  | { is: 'off' }
  | { is: 'connecting' }
  | { is: 'showing' }
  /** It connected and was lost, or never reached the host. */
  | { is: 'lost' }
  | { is: 'cannot'; why: NoPicture | null }
  /** This engine has no `RTCPeerConnection`. */
  | { is: 'unsupported' }

/** How long after a failed connection it is tried again. */
export const AGAIN_AFTER = 4000
/** How long a connection has to show the picture before it counts as failed: an offer
 *  the relay lost on the way is never answered. */
export const SHOWN_WITHIN = 20_000

/** As much of the engine's `RTCPeerConnection` as the picture uses, so a test can hand
 *  in its own. */
export interface PeerWorld {
  /** The servers a connection may use, as the account hands them out. */
  servers(): Promise<IceServer[]>
  /** A new connection through them, or null where the engine has none. */
  make(servers: IceServer[]): RTCPeerConnection | null
  after(ms: number, run: () => void): () => void
  /** Puts what the application copied on this device's clipboard. */
  copy(text: string): void
  /** This clock, in milliseconds since 1970. */
  now(): number
}

const pageWorld: PeerWorld = {
  // An account that does not know the route answers 404, and the connection makes do
  // with the STUN anybody may use.
  async servers() {
    const [{ account }, { request }] = await Promise.all([
      import('../account.svelte'),
      import('../api'),
    ])
    const token = account.accountToken
    const answer = token
      ? await request<{ iceServers?: unknown }>(ICE_PATH, { token }).catch(() => null)
      : null
    const servers = iceServersOf(answer?.iceServers)
    return servers.length > 0 ? servers : [...FALLBACK_ICE]
  },
  make: (servers) =>
    typeof RTCPeerConnection === 'function' ? new RTCPeerConnection({ iceServers: servers }) : null,
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => {
      clearTimeout(timer)
    }
  },
  now: () => Date.now(),
  copy: (text) => {
    void import('../clipboard').then(({ copyText }) => copyText(text)).catch(() => undefined)
  },
}

export class Picture {
  status = $state<PictureStatus>({ is: 'off' })
  /** What the video element shows, once the host's track has come. */
  stream = $state<MediaStream | null>(null)
  /** The application's pointer, as its host last said it on the channel. */
  pointer = $state<PointerShape | null>(null)
  /** What the audio element plays, once the host's sound has come (step 6). */
  sound = $state<MediaStream | null>(null)
  /** Whether this device shares its clipboard with the application. */
  private sharing = false
  /** The developer overlay's numbers, once a second while it is open (step 9). */
  stats = $state<StreamStats | null>(null)
  /** Glass to glass over the last second, in milliseconds: the middle of the frames'. */
  latency = $state<number | null>(null)
  /** The encoder the host makes the picture with, as its pong said. */
  encoder = $state<{ name: string | null; hardware: boolean } | null>(null)
  /** What the application uses of its host, as its last pong said (step 10). */
  usage = $state<Usage | null>(null)
  private measuring: (() => void) | null = null
  /** How many want the numbers: the overlay, and a tab's hover card. */
  private holders = 0
  private counts: Counts | null = null
  private clock: Clock | null = null
  private began: number | null = null
  private shown: number[] = []
  /** The channel input goes over, once it is open. */
  channel: RTCDataChannel | null = null
  private peer: RTCPeerConnection | null = null
  private wanted = false
  /** The one timer: the connection's deadline, or the next try. */
  private cancelTimer: (() => void) | null = null
  /** Counted up by every close, so a beginning that was waiting knows it is stale. */
  private turn = 0

  constructor(
    private readonly say: (data: string) => void,
    private readonly world: PeerWorld = pageWorld,
  ) {}

  /** Whether this device shares its clipboard with the application: the host is told
   *  now, and as the channel opens. */
  share(on: boolean): void {
    this.sharing = on
    this.input({ t: 'share', clipboard: on })
  }

  /** This device's clipboard, for the application's next paste, while it is shared. */
  paste(text: string): void {
    if (this.sharing && text) this.input({ t: 'clipboard', text: text.slice(0, MOST_CLIPBOARD) })
  }

  /** Whether the picture is wanted now: starts it, or ends it and tells the host. */
  want(on: boolean): void {
    if (on === this.wanted) return
    this.wanted = on
    if (on) {
      void this.begin()
      return
    }
    this.close()
    this.send({ bye: true })
    this.status = { is: 'off' }
  }

  /** What the host said, a `signal` frame's `data`. */
  heard(data: string): void {
    const said = fromHostOf(data)
    const peer = this.peer
    if (!said || !peer) return
    if ('cannot' in said) {
      this.close()
      this.status = { is: 'cannot', why: said.cannot }
      return
    }
    peer.setRemoteDescription({ type: 'answer', sdp: said.answer }).catch(() => {
      if (this.peer === peer) this.lost()
    })
  }

  /** Something the holder did over the picture, sent to the host while its channel is
   *  open; before that, and after, it goes nowhere. */
  input(event: InputEvent): void {
    const channel = this.channel
    if (channel?.readyState === 'open') channel.send(inputText(event))
  }

  /** The tab has gone. */
  end(): void {
    this.holders = 0
    this.measure(false)
    this.want(false)
  }

  /** The numbers wanted - by the overlay, or a hover card - until what this answers is
   *  called: while anybody wants them, the clocks are set side by side and the engine's
   *  numbers and the host's usage read, once a second. */
  hold(): () => void {
    this.holders += 1
    this.measure(true)
    let held = true
    return () => {
      if (!held) return
      held = false
      this.holders = Math.max(0, this.holders - 1)
      if (this.holders === 0) this.measure(false)
    }
  }

  private measure(on: boolean): void {
    if (on === (this.measuring !== null)) return
    if (!on) {
      this.measuring?.()
      this.measuring = null
      this.stats = null
      this.latency = null
      this.usage = null
      return
    }
    let cancel: () => void = () => undefined
    const tick = () => {
      this.input({ t: 'ping', at: this.world.now() })
      this.latency = middle(this.shown)
      this.shown = []
      const peer = this.peer
      void peer
        ?.getStats()
        .then((report) => {
          if (this.peer !== peer || !this.measuring) return
          const read = streamStats(
            report.values() as Iterable<Record<string, unknown>>,
            this.counts,
            this.world.now(),
          )
          this.stats = read.stats
          this.counts = read.counts
        })
        .catch(() => undefined)
      cancel = this.world.after(1000, tick)
    }
    this.measuring = () => {
      cancel()
    }
    tick()
  }

  /** A frame this screen showed, by its RTP time, at `shownAt` on this clock: its glass
   *  to glass, once the clocks are side by side. */
  presented(rtp: number, shownAt: number): void {
    if (!this.measuring || !this.clock || this.began === null) return
    const took = shownAt - seenAt(rtp, this.began, this.clock, this.world.now())
    if (Number.isFinite(took) && this.shown.length < 1000) this.shown.push(took)
  }

  private async begin(): Promise<void> {
    this.close()
    const turn = this.turn
    this.status = { is: 'connecting' }
    const servers = await this.world.servers().catch(() => [...FALLBACK_ICE])
    // Not wanted any more, or begun again, while the servers were asked for.
    if (turn !== this.turn || !this.wanted) return
    const peer = this.world.make(servers)
    if (!peer) {
      this.status = { is: 'unsupported' }
      return
    }
    this.peer = peer
    this.cancelTimer = this.world.after(SHOWN_WITHIN, () => {
      this.cancelTimer = null
      if (this.peer === peer && this.status.is !== 'showing') this.lost()
    })
    peer.addTransceiver('video', { direction: 'recvonly' })
    peer.addTransceiver('audio', { direction: 'recvonly' })
    const channel = peer.createDataChannel('input', { ordered: true })
    channel.onopen = () => {
      if (this.peer !== peer) return
      this.channel = channel
      this.input({ t: 'share', clipboard: this.sharing })
    }
    channel.onmessage = (event: MessageEvent) => {
      if (this.peer !== peer) return
      const said = fromPictureOf(event.data)
      if (said?.t === 'pointer') this.pointer = said
      else if (said?.t === 'clipboard' && this.sharing) this.world.copy(said.text)
      else if (said?.t === 'pong') {
        this.clock = clockOf(said, this.world.now())
        this.began = said.began
        this.encoder = { name: said.encoder, hardware: said.hardware }
        this.usage = said.usage
      }
    }
    peer.ontrack = (event) => {
      if (this.peer !== peer) return
      const stream = event.streams[0] ?? new MediaStream([event.track])
      if (event.track.kind === 'audio') this.sound = stream
      else this.stream = stream
    }
    peer.onicecandidate = (event) => {
      const found = event.candidate
      if (this.peer !== peer || !found) return
      const { candidate, sdpMid, sdpMLineIndex } = found
      this.send({ candidate: { candidate, sdpMid, sdpMLineIndex } })
    }
    peer.onconnectionstatechange = () => {
      if (this.peer !== peer) return
      if (peer.connectionState === 'connected') this.status = { is: 'showing' }
      else if (peer.connectionState === 'failed') this.lost()
    }
    try {
      await peer.setLocalDescription(await peer.createOffer())
      const sdp = peer.localDescription?.sdp
      if (this.peer !== peer) return
      if (!sdp) {
        this.lost()
        return
      }
      this.send({ offer: sdp })
    } catch {
      if (this.peer === peer) this.lost()
    }
  }

  /** Lost: shown as such, and tried again in a while if it is still wanted. */
  private lost(): void {
    this.close()
    this.status = { is: 'lost' }
    this.cancelTimer = this.world.after(AGAIN_AFTER, () => {
      this.cancelTimer = null
      if (this.wanted) void this.begin()
    })
  }

  private close(): void {
    this.turn += 1
    this.cancelTimer?.()
    this.cancelTimer = null
    const peer = this.peer
    this.peer = null
    this.channel = null
    this.stream = null
    this.sound = null
    this.pointer = null
    this.clock = null
    this.began = null
    this.counts = null
    this.shown = []
    this.encoder = null
    peer?.close()
  }

  private send(said: ToHost): void {
    this.say(toHostText(said))
  }
}

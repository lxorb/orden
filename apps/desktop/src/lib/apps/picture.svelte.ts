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
  | { is: 'lost' }
  | { is: 'cannot'; why: NoPicture | null }
  | { is: 'unsupported' }

export const AGAIN_AFTER = 4000
export const SHOWN_WITHIN = 20_000
export const QUIET_CHECK = 2000
export const QUIET_FOR = 6000

export interface PeerWorld {
  servers(): Promise<IceServer[]>
  make(servers: IceServer[]): RTCPeerConnection | null
  after(ms: number, run: () => void): () => void
  copy(text: string): void
  now(): number
}

const pageWorld: PeerWorld = {
  async servers() {
    const { account, request } = await import('../accounts/src/api')
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
    void import('../ui-controls/src/api')
      .then(({ copyText }) => copyText(text))
      .catch(() => undefined)
  },
}

export class Picture {
  status = $state<PictureStatus>({ is: 'off' })
  stream = $state<MediaStream | null>(null)
  pointer = $state<PointerShape | null>(null)
  sound = $state<MediaStream | null>(null)
  private sharing = false
  stats = $state<StreamStats | null>(null)
  latency = $state<number | null>(null)
  encoder = $state<{ name: string | null; hardware: boolean } | null>(null)
  usage = $state<Usage | null>(null)
  private measuring: (() => void) | null = null
  private holders = 0
  private counts: Counts | null = null
  private clock: Clock | null = null
  private began: number | null = null
  private shown: number[] = []
  channel: RTCDataChannel | null = null
  private peer: RTCPeerConnection | null = null
  private wanted = false
  private cancelTimer: (() => void) | null = null
  private cancelQuiet: (() => void) | null = null
  private turn = 0

  constructor(
    private readonly say: (data: string) => void,
    private readonly world: PeerWorld = pageWorld,
  ) {}

  share(on: boolean): void {
    this.sharing = on
    this.input({ t: 'share', clipboard: on })
  }

  paste(text: string): void {
    if (this.sharing && text) this.input({ t: 'clipboard', text: text.slice(0, MOST_CLIPBOARD) })
  }

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

  input(event: InputEvent): void {
    const channel = this.channel
    if (channel?.readyState === 'open') channel.send(inputText(event))
  }

  end(): void {
    this.holders = 0
    this.measure(false)
    this.want(false)
  }

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

  presented(rtp: number, shownAt: number): void {
    if (!this.measuring || !this.clock || this.began === null) return
    const took = shownAt - seenAt(rtp, this.began, this.clock, this.world.now())
    if (Number.isFinite(took) && this.shown.length < 1000) this.shown.push(took)
  }

  private async begin(): Promise<void> {
    this.close()
    const turn = this.turn
    if (this.status.is !== 'lost') this.status = { is: 'connecting' }
    const servers = await this.world.servers().catch(() => [...FALLBACK_ICE])
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
      if (peer.connectionState === 'connected') {
        this.status = { is: 'showing' }
        this.listen(peer)
      } else if (peer.connectionState === 'failed') this.lost()
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

  private listen(peer: RTCPeerConnection): void {
    if (this.cancelQuiet) return
    let heard = -1
    let heardAt = this.world.now()
    const check = () => {
      this.cancelQuiet = this.world.after(QUIET_CHECK, () => {
        void peer
          .getStats()
          .then((report) => {
            if (this.peer !== peer) return
            const bytes = receivedOf(report.values() as Iterable<Record<string, unknown>>)
            const now = this.world.now()
            if (bytes > heard) {
              heard = bytes
              heardAt = now
            } else if (now - heardAt >= QUIET_FOR) {
              this.lost()
              return
            }
            check()
          })
          .catch(() => {
            if (this.peer === peer) check()
          })
      })
    }
    check()
  }

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
    this.cancelQuiet?.()
    this.cancelQuiet = null
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

function receivedOf(report: Iterable<Record<string, unknown>>): number {
  let bytes = 0
  for (const one of report) {
    if (one.type === 'inbound-rtp' && typeof one.bytesReceived === 'number') {
      bytes += one.bytesReceived
    }
  }
  return bytes
}

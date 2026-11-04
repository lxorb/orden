/** An application's picture in its tab (issue 1063, step 4; docs/apps.md): the
 *  engine's own `RTCPeerConnection`, receive-only, offering a video and the data channel
 *  that input will take, to the host the relay passes its signalling to. The picture
 *  itself comes from the host directly, never through the relay.
 *
 *  Wanted while this device holds the application and it runs on a host that is there;
 *  not wanted, the connection ends and the host is told. A connection that fails is
 *  tried again after a while, as long as it is wanted; a host that says why it has no
 *  picture is not asked again until the picture is wanted afresh. */

import {
  fromHostOf,
  type InputEvent,
  inputText,
  type NoPicture,
  toHostText,
  type ToHost,
} from '@orden/online/apps'

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
  /** A new connection, or null where the engine has none. */
  make(): RTCPeerConnection | null
  after(ms: number, run: () => void): () => void
}

const pageWorld: PeerWorld = {
  make: () =>
    typeof RTCPeerConnection === 'function' ? new RTCPeerConnection({ iceServers: [] }) : null,
  after: (ms, run) => {
    const timer = setTimeout(run, ms)
    return () => {
      clearTimeout(timer)
    }
  },
}

export class Picture {
  status = $state<PictureStatus>({ is: 'off' })
  /** What the video element shows, once the host's track has come. */
  stream = $state<MediaStream | null>(null)
  /** The channel input goes over, once it is open. */
  channel: RTCDataChannel | null = null
  private peer: RTCPeerConnection | null = null
  private wanted = false
  /** The one timer: the connection's deadline, or the next try. */
  private cancelTimer: (() => void) | null = null

  constructor(
    private readonly say: (data: string) => void,
    private readonly world: PeerWorld = pageWorld,
  ) {}

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
    this.want(false)
  }

  private async begin(): Promise<void> {
    this.close()
    const peer = this.world.make()
    if (!peer) {
      this.status = { is: 'unsupported' }
      return
    }
    this.peer = peer
    this.status = { is: 'connecting' }
    this.cancelTimer = this.world.after(SHOWN_WITHIN, () => {
      this.cancelTimer = null
      if (this.peer === peer && this.status.is !== 'showing') this.lost()
    })
    peer.addTransceiver('video', { direction: 'recvonly' })
    const channel = peer.createDataChannel('input', { ordered: true })
    channel.onopen = () => {
      if (this.peer === peer) this.channel = channel
    }
    peer.ontrack = (event) => {
      if (this.peer !== peer) return
      this.stream = event.streams[0] ?? new MediaStream([event.track])
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
    this.cancelTimer?.()
    this.cancelTimer = null
    const peer = this.peer
    this.peer = null
    this.channel = null
    this.stream = null
    peer?.close()
  }

  private send(said: ToHost): void {
    this.say(toHostText(said))
  }
}

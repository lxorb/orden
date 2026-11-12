<script lang="ts">
  import type { InputEvent, NotStarted } from '@orden/online/apps'
  import {
    displayPoint,
    drivesPointer,
    HeldKeys,
    isPaste,
    keyEvent,
    pointerStyle,
    textEvent,
    wheelClicks,
  } from './input'
  import { clipboardSharing } from '../settings/apps-clipboard.svelte'
  import type { PictureStatus } from './picture.svelte'
  import { refreshRate, Settling } from './view'
  import { onMount, untrack } from 'svelte'
  import { account } from '../account.svelte'
  import { heldLine } from '../online/arrival.svelte'
  import { settings } from '../settings.svelte'
  import Sweep from '../Sweep.svelte'
  import type { Tab } from '../workspace.svelte'
  import { appSessionOf, type Unread } from './session.svelte'

  const { tab: shown }: { tab: Tab } = $props()
  const tab = untrack(() => shown)
  const session = appSessionOf(tab)

  let place = $state<HTMLElement>()
  let video = $state<HTMLVideoElement>()
  let audio = $state<HTMLAudioElement>()
  let typing = $state<HTMLTextAreaElement>()
  let typingAt = $state({ x: 0, y: 0 })
  let dpr = $state(window.devicePixelRatio || 1)

  $effect(() => {
    const stream = session.picture.stream
    if (video && video.srcObject !== stream) video.srcObject = stream
  })
  $effect(() => {
    const sound = session.picture.sound
    if (audio && audio.srcObject !== sound) audio.srcObject = sound
  })
  $effect(() => {
    session.picture.share(clipboardSharing.on)
  })

  let hz = 60

  function view() {
    const box = place?.getBoundingClientRect()
    return {
      width: Math.max(1, Math.round(box?.width ?? 1)),
      height: Math.max(1, Math.round(box?.height ?? 1)),
      dpr: window.devicePixelRatio || 1,
      hz,
    }
  }

  onMount(() => {
    void session.start(view())
    const settling = new Settling(
      () => {
        session.resize(view())
      },
      (ms, run) => {
        const timer = setTimeout(run, ms)
        return () => {
          clearTimeout(timer)
        }
      },
    )
    const changed = () => {
      settling.saw(null)
    }
    const watching = new ResizeObserver(changed)
    if (place) watching.observe(place)

    let measuring = 0
    const measure = () => {
      cancelAnimationFrame(measuring)
      if (document.visibilityState !== 'visible') return
      const gaps: number[] = []
      let last = 0
      const frame = (at: number) => {
        if (last) gaps.push(at - last)
        last = at
        if (gaps.length < 30) {
          measuring = requestAnimationFrame(frame)
          return
        }
        const rate = refreshRate(gaps)
        if (rate !== null && rate !== hz) {
          hz = rate
          changed()
        }
      }
      measuring = requestAnimationFrame(frame)
    }
    measure()

    let ratio: MediaQueryList | null = null
    const ratioChanged = () => {
      dpr = window.devicePixelRatio || 1
      watchRatio()
      changed()
      measure()
    }
    const watchRatio = () => {
      ratio?.removeEventListener('change', ratioChanged)
      ratio = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`)
      ratio.addEventListener('change', ratioChanged)
    }
    watchRatio()
    window.addEventListener('focus', measure)
    document.addEventListener('visibilitychange', measure)
    return () => {
      watching.disconnect()
      settling.end()
      cancelAnimationFrame(measuring)
      ratio?.removeEventListener('change', ratioChanged)
      window.removeEventListener('focus', measure)
      document.removeEventListener('visibilitychange', measure)
    }
  })

  const appName = $derived.by(() => {
    const run = session.file?.run
    if (!run) return ''
    return run.kind === 'installed' ? run.name : (run.path.split(/[\\/]/).pop() ?? run.path)
  })

  const status = $derived(session.status)
  const device = $derived(session.hostName || 'another device')
  const line = $derived.by(() => {
    switch (status.is) {
      case 'reading':
      case 'connecting':
        return 'Connecting…'
      case 'damaged':
        return 'This application’s file is damaged'
      case 'unread':
        return unreadLine(status.why)
      case 'signed-out':
        return 'Sign in to use this application.'
      case 'syncing':
        return 'Waiting for this application’s file to sync…'
      case 'unsynced':
        return 'This application’s file has not reached your account yet. Still trying…'
      case 'not-running':
        return 'Sync has not started on this device yet. Still trying…'
      case 'untaken':
        return 'Sync has not taken in this application’s file yet. Still trying…'
      case 'outside':
        return 'This application’s file is in a space that does not sync to your account.'
      case 'old-sync':
        return 'Your account is still on the old sync, which cannot carry applications.'
      case 'shared':
        return 'An application runs only from a space of your own: this space is shared with you.'
      case 'unserved':
        return 'Your account’s server does not run applications yet.'
      case 'unreachable':
        return 'Cannot reach your account’s server. Still trying…'
      case 'gone':
        return 'The computer this application runs on is no longer signed in to your account.'
      case 'away':
        return `Waiting for ${device}`
      case 'held':
        return heldLine(status.holder)
      case 'here':
        if (status.why) return notStarted(status.why, device)
        if (status.state === 'running') return `Running on ${device}`
        if (status.state === 'starting') return `Starting on ${device}…`
        if (status.state === 'exited' && status.code !== null)
          return `Exited with code ${String(status.code)}`
        return `Not running on ${device}`
    }
  })
  function unreadLine(why: Unread): string {
    switch (why) {
      case 'away':
        return 'Not on this device. It opens once you are online again.'
      case 'missing':
        return 'This application’s file is no longer there.'
      case 'denied':
        return 'Orden is not allowed to read this application’s file.'
      case 'locked':
        return 'Another program is holding this application’s file. Close it, then try again.'
      case 'unread':
        return 'This file could not be read.'
    }
  }

  function notStarted(why: NotStarted, device: string): string {
    switch (why) {
      case 'isolation':
        return `${device} cannot run an application on a display of its own yet.`
      case 'display':
        return `${device} needs Xvfb to run an application.`
      case 'permission':
        return `${device} needs Screen Recording and Accessibility.`
      case 'refused':
        return `${device} did not allow this program.`
      case 'missing':
        return `${device} does not have this application.`
      case 'handed':
        return `It was already open on ${device}, and opened there instead.`
      case 'packaged':
        return `${device} cannot start a Store application on a desktop of its own.`
      case 'failed':
        return `It did not start on ${device}.`
    }
  }

  const picture = $derived(session.picture.status)
  const showing = $derived(
    status.is === 'here' && status.state === 'running' && picture.is === 'showing',
  )
  function noPicture(picture: PictureStatus, device: string): string | null {
    switch (picture.is) {
      case 'lost':
        return 'The picture cannot reach this device.'
      case 'cannot':
        return picture.why === 'encoder'
          ? `${device} needs ffmpeg to send its picture.`
          : 'The picture could not be sent.'
      case 'unsupported':
        return 'This device cannot show the picture.'
      case 'off':
      case 'connecting':
      case 'showing':
        return null
    }
  }
  const pictureLine = $derived(noPicture(picture, device))

  let wheelLeft = { x: 0, y: 0 }
  const held = new HeldKeys()
  function send(event: InputEvent) {
    held.saw(event)
    session.picture.input(event)
  }
  function pointer(event: PointerEvent, down: boolean | null) {
    if (!video || !drivesPointer(event)) return
    const at = displayPoint(
      event.clientX,
      event.clientY,
      video.getBoundingClientRect(),
      video.videoWidth,
      video.videoHeight,
    )
    if (at) send({ t: 'move', ...at })
    if (down === null) return
    event.preventDefault()
    if (down) {
      const box = place?.getBoundingClientRect()
      if (box) typingAt = { x: event.clientX - box.left, y: event.clientY - box.top }
      typing?.focus({ preventScroll: true })
      video.setPointerCapture(event.pointerId)
    }
    send({ t: 'button', button: event.button, down })
  }
  function wheel(event: WheelEvent) {
    event.preventDefault()
    const turned = wheelClicks(wheelLeft, event.deltaX, event.deltaY, event.deltaMode)
    wheelLeft = turned.left
    if (turned.x || turned.y) send({ t: 'wheel', x: turned.x, y: turned.y })
  }
  $effect(() => {
    const over = video
    if (!over) return
    over.addEventListener('wheel', wheel, { passive: false })
    return () => {
      over.removeEventListener('wheel', wheel)
    }
  })
  let pasting: InputEvent | null = null
  function key(event: KeyboardEvent, down: boolean) {
    if (!showing) return
    const said = keyEvent(event, down)
    if (!said) return
    if (down && clipboardSharing.on && isPaste(event)) {
      pasting = said
      return
    }
    if (!down && pasting) pasted(null)
    event.preventDefault()
    send(said)
  }
  function pasted(event: ClipboardEvent | null) {
    event?.preventDefault()
    const text = event?.clipboardData?.getData('text/plain') ?? ''
    if (text) session.picture.paste(text)
    const press = pasting
    pasting = null
    if (press) send(press)
  }
  function composed(event: CompositionEvent) {
    const said = showing ? textEvent(event.data) : null
    if (said) send(said)
    if (typing) typing.value = ''
  }
  function typed(event: Event) {
    const input = event as globalThis.InputEvent
    if (!input.isComposing && input.inputType !== 'insertCompositionText') {
      const said = showing ? textEvent(input.data) : null
      if (said) send(said)
      if (typing) typing.value = ''
    }
  }
  function letGo() {
    for (const one of held.letGo()) session.picture.input(one)
  }
  function letGoButtons() {
    for (const one of held.letGoButtons()) session.picture.input(one)
  }

  let overlay = $state(false)
  $effect(() => {
    if (overlay && showing) return session.picture.hold()
  })
  $effect(() => {
    const over = video
    if (!over || !overlay || !('requestVideoFrameCallback' in over)) return
    let handle = 0
    const each = (_now: number, frame: VideoFrameCallbackMetadata) => {
      if (frame.rtpTimestamp !== undefined)
        session.picture.presented(
          frame.rtpTimestamp,
          performance.timeOrigin + frame.expectedDisplayTime,
        )
      handle = over.requestVideoFrameCallback(each)
    }
    handle = over.requestVideoFrameCallback(each)
    return () => {
      over.cancelVideoFrameCallback(handle)
    }
  })
  function figure(value: number | null | undefined, digits = 0): string {
    return value === null || value === undefined ? '–' : value.toFixed(digits)
  }

  const waiting = $derived(
    status.is === 'reading' ||
      status.is === 'connecting' ||
      status.is === 'syncing' ||
      status.is === 'away' ||
      (status.is === 'here' && status.state === 'starting' && !status.unanswered),
  )
  const again = $derived(
    status.is === 'unsynced' ||
      status.is === 'unserved' ||
      status.is === 'unreachable' ||
      status.is === 'not-running' ||
      status.is === 'untaken' ||
      status.is === 'outside' ||
      status.is === 'old-sync' ||
      status.is === 'shared' ||
      status.is === 'unread',
  )
  $effect(() => {
    if (account.accountToken && untrack(() => session.status.is) === 'signed-out') session.retry()
  })
</script>

<div class="application" data-region="editor" bind:this={place} role="application">
  <video
    bind:this={video}
    class:shown={showing}
    style:cursor={showing ? pointerStyle(session.picture.pointer, dpr) : ''}
    autoplay
    muted
    playsinline
    onpointermove={(event) => pointer(event, null)}
    onpointerdown={(event) => pointer(event, true)}
    onpointerup={(event) => pointer(event, false)}
    onpointercancel={letGoButtons}
    onlostpointercapture={letGoButtons}
    oncontextmenu={(event) => event.preventDefault()}
  ></video>
  <audio bind:this={audio} autoplay></audio>
  <textarea
    bind:this={typing}
    class="typing"
    style:left="{typingAt.x}px"
    style:top="{typingAt.y}px"
    tabindex={showing ? 0 : -1}
    aria-label={appName}
    autocomplete="off"
    autocapitalize="off"
    spellcheck="false"
    onkeydown={(event) => key(event, true)}
    onkeyup={(event) => key(event, false)}
    oncompositionend={composed}
    oninput={typed}
    onpaste={pasted}
    onblur={letGo}></textarea>
  {#if showing}
    <div class="bar">
      <button
        type="button"
        class="orden-button"
        aria-pressed={overlay}
        onclick={() => (overlay = !overlay)}>Stream stats</button
      >
      <button type="button" class="orden-button" onclick={() => session.run('restart')}
        >Restart</button
      >
      <button type="button" class="orden-button" onclick={() => session.run('stop')}>Stop</button>
    </div>
  {/if}
  {#if showing && overlay}
    {@const stats = session.picture.stats}
    {@const encoder = session.picture.encoder}
    <div class="stats">
      <p>
        <span>{figure(stats?.width)}×{figure(stats?.height)}</span>
        <span>{figure(stats?.fps)} fps</span>
        <span>{figure(stats?.bitrate == null ? null : stats.bitrate / 1e6, 1)} Mb/s</span>
      </p>
      <p>Glass to glass {figure(session.picture.latency)} ms</p>
      <p>
        <span>Round trip {figure(stats?.rtt)} ms</span>
        <span>{stats?.route ?? '–'}</span>
      </p>
      <p>Frame pacing ±{figure(stats?.pacing, 1)} ms</p>
      <p>
        <span>Dropped {stats?.dropped ?? 0}</span>
        <span>Lost {stats?.lost ?? 0}</span>
      </p>
      <p>
        <span>{stats?.codec ?? '–'}</span>
        <span
          >{encoder?.name ?? '–'}
          {#if encoder}({encoder.hardware ? 'Hardware' : 'Software'}){/if}</span
        >
      </p>
    </div>
  {/if}
  <div class="status" role="status" hidden={showing}>
    <p>{line}</p>
    {#if status.is === 'here' && session.hostPlatform === 'windows' && status.state !== 'running'}
      <p class="quiet">On Windows, some games and GPU-drawn applications show no picture.</p>
    {/if}
    {#if status.is === 'away'}
      <p class="quiet">Orden must be open there, signed in, with developer mode on.</p>
    {:else if status.is === 'here' && status.unanswered}
      <p class="quiet">{device} did not answer.</p>
    {/if}
    {#if status.is === 'signed-out'}
      <button type="button" class="orden-button" onclick={() => account.ask()}>Sign in</button>
    {:else if again}
      {#if status.is === 'outside'}
        <button type="button" class="orden-button" onclick={() => settings.show('sync')}
          >Sync settings</button
        >
      {/if}
      <button type="button" class="orden-button is-quiet" onclick={() => session.retry()}
        >Try again</button
      >
    {:else if status.is === 'held'}
      <button type="button" class="orden-button" onclick={() => session.take()}
        >{status.holder.taken ? 'Take back' : 'Take over'}</button
      >
    {:else if status.is === 'here' && status.state === 'running'}
      {#if pictureLine}
        <p class="quiet">{pictureLine}</p>
      {:else}
        <div class="sweep"><Sweep /></div>
      {/if}
      <div class="row">
        <button type="button" class="orden-button" onclick={() => session.run('restart')}
          >Restart</button
        >
        <button type="button" class="orden-button" onclick={() => session.run('stop')}>Stop</button>
      </div>
    {:else if status.is === 'here' && status.why !== 'isolation' && (status.state !== 'starting' || status.unanswered)}
      <button type="button" class="orden-button" onclick={() => session.run('start')}>Start</button>
    {:else if waiting}
      <div class="sweep"><Sweep /></div>
    {/if}
  </div>
</div>

<style>
  .application {
    position: relative;
    height: 100%;
  }

  video {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: contain;
    visibility: hidden;
  }

  video.shown {
    visibility: visible;
  }

  video {
    touch-action: none;
  }

  .typing {
    position: absolute;
    width: 1px;
    height: 1em;
    padding: 0;
    border: 0;
    opacity: 0;
    resize: none;
    overflow: hidden;
    pointer-events: none;
    caret-color: transparent;
  }

  .bar {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
    display: flex;
    gap: var(--space-2);
    opacity: 0;
    transition: opacity var(--duration-fast, 120ms);
  }

  .application:hover .bar,
  .bar:focus-within {
    opacity: 1;
  }

  .stats {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--surface) 85%, transparent);
    pointer-events: none;
  }

  .stats p {
    display: flex;
    flex-wrap: wrap;
    column-gap: var(--space-2);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    text-align: start;
  }

  .status {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: min(24rem, calc(100% - var(--space-6)));
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  p {
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  .quiet {
    color: var(--muted-strong);
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .sweep {
    width: 6rem;
  }
</style>

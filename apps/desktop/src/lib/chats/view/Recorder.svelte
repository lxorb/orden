<script lang="ts">
  import type { FileRef } from '@orden/chats'
  import { MOST_VOICE_SECONDS } from '@orden/chats/limits'
  import { onMount } from 'svelte'
  import { message as errorWords } from '../../message'
  import { record, type Recording } from '../../recorder/microphone'
  import { shortcuts } from '../../shortcuts.svelte'
  import Glyph from './Glyph.svelte'
  import { clock } from './media'
  import { sound } from './prepare'
  import { put } from './attachments.svelte'

  const {
    onsend,
    ondone,
  }: {
    onsend: (file: FileRef) => void
    ondone: () => void
  } = $props()

  let recording: Recording | null = null
  let started = $state(0)
  let now = $state(0)
  let refused = $state<string | null>(null)
  let sending = $state(false)

  onMount(() => {
    let gone = false
    record()
      .then((one) => {
        if (gone) {
          void one.stop()
          return
        }
        recording = one
        started = performance.now()
      })
      .catch((error: unknown) => (refused = errorWords(error, 'Record')))
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
      else if (event.key === 'Enter' || shortcuts.pressed('chat.record', event)) void send()
      else return
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', keys, true)
    const ticking = setInterval(() => {
      now = performance.now()
      if (started && (now - started) / 1000 >= MOST_VOICE_SECONDS) void send()
    }, 250)
    return () => {
      gone = true
      window.removeEventListener('keydown', keys, true)
      clearInterval(ticking)
      void recording?.stop()
    }
  })

  export async function send(): Promise<void> {
    const one = recording
    if (!one || sending) return
    sending = true
    recording = null
    try {
      const { bytes, seconds } = await one.stop()
      const heard = await sound(bytes).catch(() => ({ seconds, wave: undefined }))
      const type = `audio/${one.extension === 'm4a' ? 'mp4' : one.extension}`
      const hash = await put(new Blob([bytes], { type }))
      onsend({
        hash,
        name: `voice.${one.extension}`,
        size: bytes.byteLength,
        type,
        seconds: heard.seconds ?? seconds,
        ...(heard.wave ? { wave: heard.wave } : {}),
      })
    } catch (error) {
      refused = errorWords(error, 'Record')
      return
    } finally {
      sending = false
    }
    ondone()
  }

  export function cancel(): void {
    void recording?.stop()
    recording = null
    ondone()
  }
</script>

<div class="recorder" role="status">
  {#if refused}
    <span class="refused">{refused}</span>
    <button type="button" class="orden-glyph" aria-label="Close" onclick={ondone}
      ><Glyph name="close" /></button
    >
  {:else}
    <span class="dot" aria-hidden="true"></span>
    <span class="time">{clock(started ? (now - started) / 1000 : 0)}</span>
    <span class="grow"></span>
    <button type="button" class="orden-glyph" aria-label="Delete" onclick={cancel}
      ><Glyph name="close" /></button
    >
    <button
      type="button"
      class="send"
      aria-label="Send"
      disabled={sending || !started}
      onclick={() => void send()}><Glyph name="send" /></button
    >
  {/if}
</div>

<style>
  .recorder {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding: 0 var(--space-1) 0 var(--space-3);
  }

  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: var(--danger);
    animation: breathe 1.4s var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .dot {
      animation: none;
    }
  }

  .time {
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
  }

  .grow {
    flex: 1;
  }

  .refused {
    flex: 1;
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .send {
    --glyph-size: 16px;
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    transition: transform var(--dur-fast) var(--ease-spring);
  }

  .send:active:not(:disabled) {
    transform: scale(0.92);
  }
</style>

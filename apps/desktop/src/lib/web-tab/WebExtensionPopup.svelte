<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import { fade } from 'svelte/transition'
  import { dur } from '../motion'
  import { overlays } from '../overlays'
  import { invoke } from '../tauri'
  import { extensions, type Popped } from './extensions.svelte'

  const { popped, right, from }: { popped: Popped; right: number; from?: HTMLElement | null } =
    $props()

  let size = $state<{ width: number; height: number } | null>(null)
  let inside = $state<HTMLElement>()
  let bubble = $state<HTMLElement>()
  let label: string | null = null

  $effect(() =>
    overlays.show(
      () => extensions.close(popped),
      () => [bubble],
      untrack(() => from) ?? undefined,
      true,
    ),
  )

  function place() {
    const box = inside?.getBoundingClientRect()
    if (!box) return
    void invoke('extension_popup_place', {
      rect: { x: box.x, y: box.y, width: box.width, height: box.height },
    })
  }

  onMount(() => {
    let gone = false
    let unlisten: (() => void) | null = null

    void import('@tauri-apps/api/event')
      .then(({ listen }) =>
        listen<{ kind: string; width?: number; height?: number }>(
          'orden://extension-popup',
          ({ payload }) => {
            if (payload.kind === 'closed') extensions.close(popped)
            else if (payload.width && payload.height)
              size = { width: payload.width, height: payload.height }
          },
        ),
      )
      .then((stop) => {
        if (gone) stop()
        else unlisten = stop
      })
      .catch(() => undefined)

    void extensions
      .build(popped, () => {
        const box = gone ? null : inside?.getBoundingClientRect()
        return box ? { x: box.x, y: box.y, width: box.width, height: box.height } : null
      })
      .then((built) => (label = built))
    window.addEventListener('resize', place)

    return () => {
      gone = true
      unlisten?.()
      window.removeEventListener('resize', place)
      if (label) void invoke('extension_popup_close', { label }).catch(() => undefined)
    }
  })

  $effect(() => {
    if (size) requestAnimationFrame(place)
  })
</script>

<div
  bind:this={bubble}
  class="popup nib-bubble"
  class:sized={size !== null}
  style:right="{right}px"
  role="dialog"
  transition:fade={{ duration: dur(120) }}
>
  <div
    bind:this={inside}
    class="inside"
    style:width="{size?.width ?? 25}px"
    style:height="{size?.height ?? 25}px"
  ></div>
</div>

<style>
  .popup {
    position: absolute;
    top: 100%;
    z-index: var(--z-float);
    max-width: none;
    padding: 0;
    overflow: hidden;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .popup.sized {
    opacity: 1;
  }

  .inside {
    max-width: 800px;
    max-height: 600px;
    background: var(--bg);
  }
</style>

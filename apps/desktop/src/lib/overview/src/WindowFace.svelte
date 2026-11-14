<script lang="ts" module>
  // eslint-disable-next-line svelte/prefer-svelte-reactivity -- read as a window is drawn, never rendered
  const drawnBefore = new Map<string, { key: string; html: string }>()
</script>

<script lang="ts">
  import { untrack } from 'svelte'
  import { dur, fade } from '../../platform/src/api'
  import { links } from '../../link-index.svelte'
  import { readingHtml, unreadableHtml } from '../../reading/render'
  import { trustsHtmlIn } from '../../sharing/src/api'
  import { noteBehind } from '../../protect/src/api'
  import TabMark from '../../TabMark.svelte'
  import { theme } from '../../theme/src/api'
  import { pages } from '../../web-tab/pages.svelte'
  import { type Tab, workspace } from '../../workspace.svelte'
  import { TAB_KINDS } from '../../workspace/tab-kinds'
  import { drawInto, type Face } from './faces'
  import { scrolledBack } from './mirror'
  import { readingFrom, scrollbackOf } from './previews'

  const {
    tab,
    face,
    width,
    height,
    drawing,
    flying = false,
  }: {
    tab: Tab
    face: Face | null
    width: number
    height: number
    drawing?: (done: Promise<unknown>) => void
    flying?: boolean
  } = $props()

  const how = $derived(TAB_KINDS[tab.kind].preview)
  const locked = $derived(workspace.protection.locked(noteBehind(tab)))

  const START = 6000

  const reading = $derived.by(() => {
    if (how !== 'reading' || locked) return null
    const text = readingFrom(tab.doc, tab.anchor, START)
    const scheme = theme.current
    const trusted = trustsHtmlIn(tab.note)
    const locks = links.locksSeen()
    return {
      text,
      scheme,
      trusted,
      key: `${locks}\u0000${scheme}\u0000${String(trusted)}\u0000${text}`,
    }
  })

  const readBefore = untrack(() => reading && drawnBefore.get(tab.id))
  let made = $state(
    readBefore && readBefore.key === untrack(() => reading?.key) ? readBefore.html : '',
  )

  $effect(() => {
    const asked = reading
    if (!asked) return
    const known = drawnBefore.get(tab.id)
    if (known?.key === asked.key) {
      made = known.html
      return
    }
    let stale = false
    const done = readingHtml({ text: asked.text, path: tab.path }, asked.scheme, asked.trusted)
      .catch(() => unreadableHtml(asked.text))
      .then((html) => {
        drawnBefore.set(tab.id, { key: asked.key, html })
        if (!stale) made = html
      })
    untrack(() => drawing?.(done))
    return () => {
      stale = true
    }
  })

  let html = $state(untrack(() => made))
  $effect.pre(() => {
    const now = made
    if (!flying) html = now
  })

  const latestShot = $derived(
    how === 'photograph' ? (pages.of(tab.id).shot ?? face?.shot ?? null) : null,
  )
  let shot = $state(untrack(() => latestShot))
  $effect.pre(() => {
    const now = latestShot
    if (!flying) shot = now
  })
  let decodedShot = $state<string | null>(null)

  let kept = $state(untrack(() => face))
  $effect.pre(() => {
    const now = face
    if (!flying) kept = now
  })

  let readScreen = $state<{ text: string; cols: number } | null>(null)
  $effect(() => {
    if (how !== 'scrollback' || locked) return
    let stale = false
    const done = scrollbackOf(tab).then((one) => {
      if (!stale) readScreen = one
    })
    untrack(() => drawing?.(done))
    return () => {
      stale = true
    }
  })
  let screen = $state<{ text: string; cols: number } | null>(null)
  $effect.pre(() => {
    const now = readScreen
    if (!flying) screen = now
  })

  function drawn(node: HTMLElement, kept: Face) {
    const draw = (one: Face) => {
      if (one.html) drawInto(node, one.html)
      requestAnimationFrame(() => scrolledBack(node))
    }
    draw(kept)
    return { update: draw }
  }

  function decoded(node: HTMLImageElement, shot: string) {
    const decode = (one: string) => {
      const done =
        typeof node.decode === 'function' ? node.decode().then(() => one) : Promise.resolve(one)
      drawing?.(done)
      void done.then(
        (seen) => {
          if (seen === shot) decodedShot = seen
        },
        () => undefined,
      )
    }
    decode(shot)
    return { update: decode }
  }

  const arrive = { duration: dur(160) }

  const whence = $derived.by(() => {
    if (tab.kind === 'web') {
      try {
        return new URL(pages.of(tab.id).url ?? '').host
      } catch {
        return ''
      }
    }
    const path = tab.path ?? ''
    return path.slice(0, path.lastIndexOf('/')).replace(/^\//, '')
  })
</script>

{#snippet mark()}
  <div class="mark">
    <span class="big"><TabMark {tab} /></span>
    <span class="name">{tab.shown}</span>
    {#if whence}<span class="whence">{whence}</span>{/if}
  </div>
{/snippet}

<div class="face" style:width="{width}px" style:height="{height}px">
  {#if locked || how === 'mark'}
    {@render mark()}
  {:else if how === 'reading' && html}
    <div class="read" in:fade={arrive}>
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note's own words, rendered by the same renderer the reading view uses, under the same trust -->
      <article class="page orden-write">{@html html}</article>
    </div>
  {:else if how === 'scrollback' && screen}
    <pre class="screen" in:fade={arrive}>{screen.text}</pre>
  {:else if how === 'photograph' && shot}
    {@render mark()}
    <img
      class="shot"
      class:is-drawn={decodedShot === shot}
      src={shot}
      alt=""
      draggable="false"
      use:decoded={shot}
    />
  {:else if kept?.html}
    <div
      class="kept"
      style:width="{kept.w}px"
      style:height="{Math.max(kept.h, (kept.w * height) / Math.max(width, 1))}px"
      style:scale={width / Math.max(kept.w, 1)}
      in:fade={arrive}
      use:drawn={kept}
    ></div>
  {:else}
    {@render mark()}
  {/if}
</div>

<style>
  .face {
    position: relative;
    overflow: hidden;
    background: var(--bg);
    pointer-events: none;
  }

  .read {
    height: 100%;
    overflow: hidden;
    padding-top: var(--space-6);
  }

  .kept {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    overflow: hidden;
  }

  .kept > :global(*) {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
  }

  .screen {
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    height: 100%;
    margin: 0;
    padding: var(--space-3) var(--space-4);
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: var(--text-row);
    line-height: 1.35;
    white-space: pre;
  }

  .shot {
    position: absolute;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    opacity: 0;
    object-fit: cover;
    object-position: top;
  }

  .shot.is-drawn {
    opacity: 1;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .mark {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: var(--space-4);
    height: 100%;
    color: var(--muted);
    font-size: calc(2.4 * var(--text-base));
  }

  .big {
    display: flex;
    scale: 4;
    margin-bottom: var(--space-6);
  }

  .whence {
    max-width: 80%;
    overflow: hidden;
    color: var(--faint, var(--muted));
    font-size: calc(1.5 * var(--text-base));
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .name {
    max-width: 80%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

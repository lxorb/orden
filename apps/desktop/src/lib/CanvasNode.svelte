<script lang="ts">
  import { onDestroy } from 'svelte'
  import {
    createEditor,
    type EditorView,
    embedClicks,
    type LinkPress,
    type NoteJump,
    setReadOnlyMode,
    type Text,
  } from '@orden/editor'
  import type { EmbeddedNote } from '@orden/markdown'
  import type { CanvasNode } from './canvas/format'
  import { cardHtml, fileSource, fileUrl, isPicture, keptByAccount } from './canvas/render'
  import { account } from './account.svelte'
  import CanvasPdf from './CanvasPdf.svelte'
  import { type Box, isLineShape, shapeLine, shapePath } from './canvas/geometry'
  import { shownColour } from './canvas/palette'
  import { cardWriting } from './canvas/writing'
  import { pickedLink } from './composer'
  import { t } from './i18n.svelte'
  import { links } from './link-index.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { followHref } from './open-link'

  const {
    node,
    canvasPath,
    trusted,
    root,
    picked,
    dimmed = false,
    editing,
    readOnly = false,
    offset,
    scale = 1,
    seen = null,
    ontext,
    onleave,
    onfollow,
  }: {
    node: CanvasNode
    canvasPath: string | null
    trusted: boolean
    root: string | null
    picked: boolean
    dimmed?: boolean
    editing: boolean
    readOnly?: boolean
    offset: { x: number; y: number }
    scale?: number
    seen?: Box | null
    ontext?: (text: string) => void
    onleave?: () => void
    onfollow?: (jump: NoteJump, press: LinkPress | undefined, from: string | null) => void
  } = $props()

  const colour = $derived(shownColour(node.color))

  let source = $state<EmbeddedNote | null>(null)

  $effect(() => {
    if (node.type !== 'file' || isPicture(node.file)) return

    const wanted = node.file
    let mine = true
    void fileSource(wanted, canvasPath).then((text) => {
      if (mine) source = text
    })

    return () => {
      mine = false
    }
  })

  const words = $derived(
    node.type === 'text' ? node.text : node.type === 'shape' ? (node.text ?? '') : source?.text,
  )
  const markup = $derived(trusted && !(node.type === 'file' && source?.escapeHtml !== false))

  const html = $derived(words ? cardHtml(words, canvasPath, markup) : '')

  const drawing = $derived.by(() => {
    if (node.type !== 'shape') return null

    const points = shapePath(node).map((one) => ({ x: one.x - node.x, y: one.y - node.y }))
    const d = `M ${points.map((one) => `${one.x} ${one.y}`).join(' L ')}`
    const open = isLineShape(node.shape)

    return { d: open ? d : `${d} Z`, open, points }
  })

  const HEAD = 11

  const head = $derived.by(() => {
    if (node.type !== 'shape' || node.shape !== 'arrow') return null

    const ends = shapeLine(node)
    const from = { x: ends.from.x - node.x, y: ends.from.y - node.y }
    const to = { x: ends.to.x - node.x, y: ends.to.y - node.y }
    const dx = to.x - from.x
    const dy = to.y - from.y
    const away = Math.hypot(dx, dy) || 1

    return {
      x: to.x,
      y: to.y,
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      size: Math.min(HEAD, away / 3),
    }
  })

  let broken = $state(false)
  let instead = $state<string | null>(null)

  $effect(() => {
    if (node.type === 'file' && node.file) {
      broken = false
      instead = null
    }
  })

  function unloaded(file: string) {
    const elsewhere = instead ? null : keptByAccount(file, !!account.accountToken)
    if (elsewhere) instead = elsewhere
    else broken = true
  }

  const host = $derived.by(() => {
    if (node.type !== 'link') return ''
    try {
      return new URL(node.url).hostname.replace(/^www\./, '')
    } catch {
      return node.url
    }
  })

  let editor: EditorView | undefined
  let typed = ''

  let handed: string | null = null

  function hand() {
    if (typed === handed) return

    handed = typed
    ontext?.(typed)
  }

  function edit(host: HTMLElement) {
    if (node.type !== 'text' && node.type !== 'shape') return

    typed = words ?? ''
    handed = null
    editor = createEditor({
      parent: host,
      doc: typed,
      onChange: (doc: Text) => {
        typed = doc.toString()
      },
      notes: links.index(canvasPath, canvasPath === null && !trusted),
      writeLink: pickedLink,
      trustedMarkup: trusted,
      ...(onfollow
        ? { openNote: (jump: NoteJump, press?: LinkPress) => onfollow(jump, press, canvasPath) }
        : {}),
      openLink: followHref,
      shortcuts: shortcuts.forEditor,
    })
    if (readOnly) setReadOnlyMode(editor, true)
    editor.focus()
    cardWriting(hand)

    return {
      destroy: () => {
        cardWriting(null)
        hand()
        editor?.destroy()
        editor = undefined
      },
    }
  }

  onDestroy(() => {
    editor?.destroy()
    editor = undefined
  })

  function embeds(host: HTMLElement) {
    const held = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return

      const card = target.closest('.embed-web')
      if (card instanceof HTMLElement && card.dataset.loaded === undefined) {
        event.stopPropagation()
      }
    }

    host.addEventListener('pointerdown', held)
    const away = embedClicks(host)

    return {
      destroy: () => {
        host.removeEventListener('pointerdown', held)
        away()
      },
    }
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    onleave?.()
  }
</script>

<div
  class="node"
  class:picked
  class:dimmed
  class:group={node.type === 'group'}
  class:shape={node.type === 'shape'}
  class:bare={node.type === 'text' && node.bare}
  class:editing
  class:coloured={colour !== null}
  data-id={node.id}
  style:left="{node.x}px"
  style:top="{node.y}px"
  style:width="{node.width}px"
  style:height="{node.height}px"
  style:translate="{offset.x}px {offset.y}px"
  style:--card-colour={colour}
>
  {#if node.type === 'text'}
    {#if editing}
      <div class="editor" use:edit onkeydowncapture={onKey}></div>
    {:else}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the reader's own note, through the same renderer the reading view uses -->
      <div class="card page orden-rendered" use:embeds>{@html html}</div>
    {/if}
  {:else if node.type === 'file'}
    {#if isPicture(node.file)}
      {#if broken}
        <p class="missing">{t('Nothing here')}</p>
      {:else}
        <img
          class="picture"
          src={instead ?? fileUrl(node.file, root)}
          alt={node.file}
          draggable="false"
          onerror={() => unloaded(node.file)}
        />
      {/if}
    {:else if /\.pdf$/i.test(node.file)}
      <CanvasPdf file={node.file} note={canvasPath} {root} box={node} {scale} {seen} />
    {:else if html}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note this card names, through the same renderer the reading view uses -->
      <div class="card page embed orden-rendered" use:embeds>{@html html}</div>
    {:else}
      <p class="missing">{t('Nothing here')}</p>
    {/if}
  {:else if node.type === 'link'}
    <div class="card link">
      <span class="host">{host}</span>
      <span class="url">{node.url}</span>
    </div>
  {:else if node.type === 'shape'}
    <svg
      class="drawn"
      class:filled={node.fill}
      viewBox="0 0 {node.width} {node.height}"
      width={node.width}
      height={node.height}
      aria-hidden="true"
    >
      {#if node.shape === 'rect'}
        <rect
          x="1"
          y="1"
          width={Math.max(0, node.width - 2)}
          height={Math.max(0, node.height - 2)}
          rx="4"
        />
      {:else if node.shape === 'ellipse'}
        <ellipse
          cx={node.width / 2}
          cy={node.height / 2}
          rx={Math.max(0, node.width / 2 - 1)}
          ry={Math.max(0, node.height / 2 - 1)}
        />
      {:else if drawing}
        <path class={drawing.open ? 'stroke' : 'body'} d={drawing.d} />
        {#if head}
          <path
            class="point"
            d="M 0 0 L {-head.size} {-head.size * 0.5} L {-head.size} {head.size * 0.5} Z"
            transform="translate({head.x} {head.y}) rotate({head.angle})"
          />
        {/if}
      {/if}
    </svg>

    {#if editing}
      <div class="editor inside" use:edit onkeydowncapture={onKey}></div>
    {:else if html}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the reader's own words, through the same renderer the reading view uses -->
      <div class="card page inside orden-rendered">{@html html}</div>
    {/if}
  {:else if node.type === 'group' && node.label}
    <span class="label">{node.label}</span>
  {/if}
</div>

<style>
  .node {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--card-colour, var(--line-strong));
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    contain: strict;
    touch-action: none;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .node.coloured {
    background: color-mix(in srgb, var(--card-colour) 9%, var(--surface));
  }

  .node.dimmed {
    opacity: 0.25;
  }

  .node.picked {
    border-color: var(--accent);
    box-shadow:
      0 0 0 1px var(--accent),
      var(--shadow-md);
  }

  .node.editing {
    box-shadow: var(--shadow-md);
  }

  .node.group {
    background: color-mix(in srgb, var(--card-colour, var(--muted)) 7%, transparent);
    border-style: dashed;
    border-radius: var(--radius-lg);
    box-shadow: none;
    overflow: visible;
  }

  .node.shape {
    background: none;
    border: none;
    box-shadow: none;
    overflow: visible;
  }

  .node.shape.picked {
    box-shadow: none;
  }

  .node.bare,
  .node.bare.coloured {
    border-color: transparent;
    background: none;
    box-shadow: none;
  }

  .node.bare.picked,
  .node.bare.editing {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
    box-shadow: none;
  }

  .node.bare .card,
  .node.bare .editor :global(#write) {
    padding: 4px 6px;
    color: var(--card-colour, var(--text));
    font-size: 16px;
  }

  .drawn {
    display: block;
    overflow: visible;
    fill: none;
    stroke: var(--card-colour, var(--text-strong));
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .drawn.filled rect,
  .drawn.filled ellipse,
  .drawn.filled .body {
    fill: color-mix(in srgb, var(--card-colour, var(--muted)) 14%, transparent);
  }

  .drawn .point {
    fill: var(--card-colour, var(--text-strong));
    stroke: none;
  }

  .inside {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
    pointer-events: none;
  }

  .editor.inside {
    pointer-events: auto;
    height: auto;
    text-align: start;
  }

  .editor.inside :global(.cm-editor) {
    height: auto;
  }

  .label {
    position: absolute;
    left: 2px;
    bottom: 100%;
    padding: 2px 6px;
    color: var(--card-colour, var(--muted-strong));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    white-space: nowrap;
  }

  .card {
    width: 100%;
    height: 100%;
    padding: 8px 12px;
    overflow: hidden;
    color: var(--text);
    font-family: var(--font-content);
    font-size: 13px;
    line-height: 1.55;
  }

  .card.page :global(> :first-child) {
    margin-top: 0;
  }

  .card.page :global(> :last-child) {
    margin-bottom: 0;
  }

  .card.page :global(h1),
  .card.page :global(h2),
  .card.page :global(h3) {
    margin: 0 0 4px;
    font-size: 1.15em;
    line-height: 1.3;
    color: var(--text-strong);
  }

  .card.page :global(p) {
    margin: 0 0 6px;
  }

  .card.page :global(ul),
  .card.page :global(ol) {
    margin: 0 0 6px;
    padding-inline-start: 1.2em;
  }

  .card.page :global(img) {
    max-width: 100%;
  }

  .card.page :global(a) {
    color: var(--accent);
    text-decoration: none;
  }

  .card.page :global(code) {
    font-family: var(--font-mono);
    font-size: 0.92em;
  }

  .embed {
    color: var(--muted-strong);
  }

  .picture {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
    -webkit-user-select: none;
  }

  .link {
    display: flex;
    flex-direction: column;
    gap: 2px;
    justify-content: center;
  }

  .host {
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .url {
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .missing {
    margin: 0;
    padding: 8px 12px;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .editor {
    width: 100%;
    height: 100%;
    overflow: hidden;
  }

  .editor :global(.cm-editor) {
    height: 100%;
  }

  .editor :global(#write) {
    max-width: none;
    margin: 0;
    padding: 8px 12px;
    font-size: 13px;
    line-height: 1.55;
  }
</style>

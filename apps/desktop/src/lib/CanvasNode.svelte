<script lang="ts">
  /** One card on the canvas: its frame, and whatever is inside it.
   *
   *  Positioned rather than laid out. Every card is absolute at the plane
   *  coordinates the file gives it, so the surface above can move the whole plane
   *  with one transform and the browser has no layout to redo; a card being
   *  dragged is offset by a transform of its own, for the same reason.
   *
   *  The chrome is not here. Which card is picked, its handles and the dots an
   *  edge is dragged from all belong to the surface, which is what owns the
   *  gestures; this is the card itself. */

  import { onDestroy } from 'svelte'
  import { createEditor, type EditorView, type NoteJump, type Text } from '@nib/editor'
  import type { CanvasNode } from './canvas/format'
  import { cardHtml, fileSource, fileUrl, isPicture } from './canvas/render'
  import { shownColour } from './canvas/palette'
  import { t } from './i18n.svelte'
  import { links } from './link-index.svelte'
  import { shortcuts } from './shortcuts.svelte'
  import { openExternal } from './tauri'

  const {
    node,
    canvasPath,
    root,
    picked,
    editing,
    offset,
    ontext,
    onleave,
    onfollow,
  }: {
    node: CanvasNode
    /** The canvas's own path, so a link in a card resolves from where it lives. */
    canvasPath: string | null
    /** The space's folder, which is what a file node's path is relative to. */
    root: string | null
    picked: boolean
    /** Whether this card is the one being written in. */
    editing: boolean
    /** How far a drag has carried it since the pointer went down. */
    offset: { x: number; y: number }
    ontext?: (text: string) => void
    onleave?: () => void
    onfollow?: (jump: NoteJump) => void
  } = $props()

  /** The card's own colour, as a border and a wash. Null for one with none,
   *  which wears the surface. */
  const colour = $derived(shownColour(node.color))

  /** The words of the note a file node names, once they have arrived. Null until
   *  then, and for a file the space no longer holds. */
  let source = $state<string | null>(null)

  $effect(() => {
    if (node.type !== 'file' || isPicture(node.file)) return

    const wanted = node.file
    let mine = true
    void fileSource(wanted).then((text) => {
      if (mine) source = text
    })

    return () => {
      mine = false
    }
  })

  /** The card's markdown as HTML. Read from the cache next door, so a card that
   *  has not changed costs nothing however often the plane moves. */
  const html = $derived(
    node.type === 'text'
      ? cardHtml(node.text, canvasPath)
      : source === null
        ? ''
        : cardHtml(source, canvasPath),
  )

  /** A link node's host, which is the closest thing to a title that can be known
   *  without asking the web for one. */
  const host = $derived.by(() => {
    if (node.type !== 'link') return ''
    try {
      return new URL(node.url).hostname.replace(/^www\./, '')
    } catch {
      // Not a URL a browser would parse, so the whole of it is the name.
      return node.url
    }
  })

  let editor: EditorView | undefined
  let typed = ''

  /** The small editor, mounted only while this card is being written in and taken
   *  down the moment it is not: five hundred cards must not be five hundred
   *  editors, and the one that exists is sized to its own card. */
  function edit(host: HTMLElement) {
    if (node.type !== 'text') return

    typed = node.text
    editor = createEditor({
      parent: host,
      doc: node.text,
      onChange: (doc: Text) => {
        typed = doc.toString()
      },
      notes: links.index(canvasPath),
      ...(onfollow ? { openNote: onfollow } : {}),
      openLink: (href: string) => void openExternal(href),
      shortcuts: shortcuts.forEditor,
    })
    editor.focus()

    return {
      destroy: () => {
        ontext?.(typed)
        editor?.destroy()
        editor = undefined
      },
    }
  }

  onDestroy(() => {
    editor?.destroy()
    editor = undefined
  })

  /** Escape leaves the card. Everything else belongs to the editor inside it,
   *  including the keys that would otherwise reach the canvas: a card being
   *  written in is a text field, and Delete in one deletes a character. */
  function onKey(event: KeyboardEvent) {
    if (event.key !== 'Escape') {
      event.stopPropagation()
      return
    }

    event.preventDefault()
    event.stopPropagation()
    onleave?.()
  }
</script>

<div
  class="node"
  class:picked
  class:group={node.type === 'group'}
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
      <div class="card page">{@html html}</div>
    {/if}
  {:else if node.type === 'file'}
    {#if isPicture(node.file)}
      <img class="picture" src={fileUrl(node.file, root)} alt={node.file} draggable="false" />
    {:else if html}
      <!-- eslint-disable-next-line svelte/no-at-html-tags -- the note this card names, through the same renderer the reading view uses -->
      <div class="card page embed">{@html html}</div>
    {:else}
      <p class="missing">{t('Nothing here')}</p>
    {/if}
  {:else if node.type === 'link'}
    <div class="card link">
      <span class="host">{host}</span>
      <span class="url">{node.url}</span>
    </div>
  {:else if node.label}
    <span class="label">{node.label}</span>
  {/if}
</div>

<style>
  /* Absolute at its own plane coordinates: the surface moves the plane, never
     the cards. */
  .node {
    position: absolute;
    box-sizing: border-box;
    border: 1px solid var(--card-colour, var(--line-strong));
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    /* The pointer belongs to the surface, which decides what a press means. */
    touch-action: none;
    transition:
      box-shadow var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  /* A card with a colour wears it as a breath of it behind the words, so a
     coloured card still reads as paper rather than as a block of paint. */
  .node.coloured {
    background: color-mix(in srgb, var(--card-colour) 9%, var(--surface));
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

  /* A group is room with a name on it: a frame, and nothing in the middle to
     get in the way of what sits inside it. */
  .node.group {
    background: color-mix(in srgb, var(--card-colour, var(--muted)) 7%, transparent);
    border-style: dashed;
    border-radius: var(--radius-lg);
    box-shadow: none;
    overflow: visible;
  }

  .label {
    position: absolute;
    left: 2px;
    bottom: 100%;
    padding: 2px 6px;
    color: var(--card-colour, var(--muted-strong));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
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

  /* A card is a page a couple of inches across, so the rendered markdown is
     tightened rather than left at document spacing: the same shapes, closer
     together. */
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
    padding-left: 1.2em;
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

  /* An embedded note is somebody else's words, so it reads a shade quieter than
     a card of your own. */
  .embed {
    color: var(--muted-strong);
  }

  .picture {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    user-select: none;
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
    font-weight: 550;
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

  /* The editor fills the card it was mounted in, and scrolls inside it: a card
     is as big as somebody made it, and the words go in it rather than the other
     way about. */
  .editor :global(.cm-editor) {
    height: 100%;
  }

  .editor :global(.cm-scroller) {
    padding: 4px 6px;
    font-size: 13px;
  }

  .editor :global(.cm-content) {
    padding: 0;
    max-width: none;
  }
</style>

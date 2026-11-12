<script lang="ts">
  import { untrack } from 'svelte'
  import type { Cover } from '@orden/markdown/cover'
  import {
    createEditor,
    editorState,
    type EditorView,
    type FindAsk,
    HeldState,
    keptCoverEffect,
    type LinkPress,
    modeEffects,
    type NoteIndex,
    type NoteJump,
    noteIndexEffect,
    placeAt,
    type PreviewNote,
    type StateEffect,
    type StateOptions,
    shortcutEffect,
    trustedMarkupEffect,
  } from '@orden/editor'
  import { pickedLink } from './composer'
  import { EditorStates } from './editor-states'
  import { firstScreen } from './first-screen.svelte'
  import { keptCoverOf, setCoverPosition } from './kept-cover'
  import { mark } from './trace'
  import { modes } from './modes.svelte'
  import { type OverlayScrollbar, overlayScrollbar } from './scrollbar'
  import { shortcuts } from './shortcuts.svelte'
  import { trustsHtmlIn } from './sharing.svelte'
  import { pastesMarkup } from './trust'
  import { viewport } from './viewport.svelte'
  import { carriedIntoNotes } from './drag-paths'
  import { type Tab, workspace } from './workspace.svelte'

  /* eslint-disable prefer-const -- `view` is bindable, and a $props() pattern cannot be split */
  let {
    tab,
    kept,
    onimage,
    resolveimage,
    openlink,
    onselection,
    notes,
    opennote,
    nameblock,
    onfind,
    onfindslow,
    focused,
    view = $bindable(),
  }: {
    tab: Tab
    kept: Tab[]
    onimage?: (file: File, tab: Tab) => Promise<string | null>
    resolveimage?: (src: string, tab: Tab) => string
    openlink?: (href: string, press: LinkPress) => void
    onselection?: (view: EditorView) => void
    notes?: (tab: Tab) => NoteIndex
    opennote?: (jump: NoteJump, press: LinkPress | undefined, from: string | null) => void
    nameblock?: (path: string, line: number, from: Tab) => Promise<string | null>
    onfind?: (ask: FindAsk | null) => void
    onfindslow?: (view: EditorView) => void
    focused: boolean
    view?: EditorView | undefined
  } = $props()
  /* eslint-enable prefer-const */

  function previewCard(host: HTMLElement, note: PreviewNote): (() => void) | null {
    if (workspace.activeSpace?.root === undefined) return null

    const from = tab.path
    let release: (() => void) | null = null
    let gone = false
    void import('./preview-card').then(({ mountPreview }) => {
      if (!gone) release = mountPreview(host, note, from)
    })

    return () => {
      gone = true
      release?.()
    }
  }

  const FORMER_HANDLE = 'nib'
  let host: HTMLDivElement
  const rise = firstScreen.rise()
  const states = new EditorStates()
  let bar: OverlayScrollbar | undefined
  function optionsFor(one: Tab): StateOptions {
    return {
      shared: one.note.live,
      selection: { anchor: one.cursor ?? 0 },
      ...(onimage ? { onImage: (file: File) => onimage(file, one) } : {}),
      ...(resolveimage ? { resolveImage: (src: string) => resolveimage(src, one) } : {}),
      ...(openlink ? { openLink: openlink } : {}),
      ...(onselection ? { onSelection: onselection } : {}),
      ...(notes ? { notes: notes(one) } : {}),
      ...(opennote
        ? { openNote: (jump: NoteJump, press?: LinkPress) => opennote(jump, press, one.path) }
        : {}),
      openTag: (tag: string) => void import('./tag-search').then(({ searchTag }) => searchTag(tag)),
      ...(nameblock
        ? { nameBlock: (path: string, line: number) => nameblock(path, line, one) }
        : {}),
      writeLink: pickedLink,
      carriedNotes: (transfer) => workspace.carriedNotes(transfer),
      carriedFiles: carriedIntoNotes,
      ...(onfind ? { onFind: onfind } : {}),
      ...(onfindslow ? { onFindSlow: onfindslow } : {}),
      shortcuts: shortcuts.forEditor,
      trustedMarkup: trustsHtmlIn(one.note),
      cover: keptCoverOf(one.path),
      moveCover: (position: number) => {
        if (one.path) setCoverPosition(one.path, position)
      },
      editPreview: previewCard,
      coveredBelow: () => viewport.covered,
      ...(one.folds?.length ? { folds: one.folds } : {}),
    }
  }

  function placeOf(one: Tab): StateEffect<unknown> | null {
    return one.anchor === undefined ? null : placeAt(one.anchor)
  }

  function dressing(one: Tab): string {
    return JSON.stringify([modes.settingsFor(one), shortcuts.forEditor])
  }

  function fitting(
    one: Tab,
    index: NoteIndex | undefined,
    trusted: boolean,
    cover: Cover | null,
  ): StateEffect<unknown>[] {
    const stamp = dressing(one)
    const dressed = states.fitted(one) === stamp
    states.fit(one, stamp)

    return [
      ...(index ? [noteIndexEffect(index)] : []),
      trustedMarkupEffect(trusted),
      keptCoverEffect(cover),
      ...(dressed ? [] : modeEffects(modes.settingsFor(one))),
      ...(dressed ? [] : [shortcutEffect(shortcuts.forEditor)]),
    ]
  }

  $effect(() => {
    const first = untrack(() => tab)
    const created = createEditor({ parent: host, ...untrack(() => optionsFor(first)) })
    mark('editor built')

    states.started(
      first,
      created,
      untrack(() => placeOf(first)),
    )
    view = created
    bar = overlayScrollbar(created.scrollDOM, created.dom)
    if (__DRIVEABLE__) Object.assign(window, { orden: created, [FORMER_HANDLE]: created })

    return () => {
      states.releaseAll(created)
      bar?.stop()
      bar = undefined
      created.destroy()
      view = undefined
    }
  })

  $effect(() => {
    view?.contentDOM.setAttribute('aria-label', 'The note')
  })

  $effect(() => {
    if (focused) view?.contentDOM.setAttribute('id', 'write')
    else view?.contentDOM.removeAttribute('id')
  })

  const shownIndex = $derived(notes?.(tab))

  $effect(() => {
    const current = view
    const showing = tab
    if (!current) return

    const switching = !states.shows(showing)
    const index = shownIndex
    const trusted = trustsHtmlIn(showing.note)
    const cover = keptCoverOf(showing.path)

    untrack(() => {
      modes.shows(current, showing, () => workspace.scheduleSession())
      states.show(current, showing, () => build(showing), fitting(showing, index, trusted, cover))

      if (switching) bar?.settle()

      if (switching && showing.anchor === undefined && showing.scroll) {
        current.scrollDOM.scrollTop = showing.scroll
      }

      if (switching) onselection?.(current)
    })
  })

  function build(one: Tab): HeldState {
    return HeldState.waiting(one.note.live, editorState(optionsFor(one)), placeOf(one))
  }

  $effect(() => {
    states.keepOnly(kept)
  })
</script>

<div
  class="surface"
  class:rise
  bind:this={host}
  onpastecapture={(event: ClipboardEvent) => {
    const carried = event.clipboardData
    if (carried && pastesMarkup([...carried.types], carried.getData('text/plain'))) {
      tab.note.pasted = true
    }
  }}
></div>

<style>
  .surface {
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }

  .rise {
    animation: rise var(--dur-slow) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(5px);
    }
  }
</style>

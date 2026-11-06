<script module lang="ts">
  let pressing = false
  let pressedOn: Element | null = null
  if (typeof window !== 'undefined') {
    window.addEventListener(
      'pointerdown',
      (event) => {
        pressing = true
        pressedOn = event.target instanceof Element ? event.target : null
      },
      true,
    )
    for (const ends of ['pointerup', 'pointercancel'])
      window.addEventListener(ends, () => (pressing = false), true)
  }

  function afterPress(run: () => void) {
    if (!pressing) {
      run()
      return
    }
    window.addEventListener('pointerup', () => setTimeout(run, 0), { once: true, capture: true })
  }
</script>

<script lang="ts">
  import { onMount, untrack } from 'svelte'
  import FileMark from '../FileMark.svelte'
  import { t } from '../i18n.svelte'
  import { overlays } from '../overlays'
  import Suggest from '../Suggest.svelte'
  import { frecency } from '../frecency'
  import { links } from '../link-index.svelte'
  import { pieces } from '../palette/pieces'
  import { dotCom, type HalfTyped } from './typed'
  import { shownAddress } from './omnibox'
  import { visited } from './visited'
  import { leads, noteKey, webNotesFor, webNotesOf, type WebNote } from './web-notes'
  import type { Visit } from './visits'

  type Offer = { kind: 'page'; visit: Visit } | { kind: 'note'; note: WebNote }

  const NOTE = 'nib-note:'

  const {
    resting,
    address,
    book,
    onenter,
    ontyping,
    onnote,
    held = { halfTyped: null },
  }: {
    resting: string
    address: string
    book: string
    onenter: (said: string, aside: boolean, typed: string) => void
    ontyping: (on: boolean) => void
    onnote?: ((path: string) => void) | undefined
    held?: { halfTyped: HalfTyped | null; keyboard?: 'address' | 'page' | null }
  } = $props()

  const id = $props.id()

  let field = $state<HTMLInputElement>()
  let editing = $state(false)
  let typed = $state('')
  let rows = $state<Offer[]>([])
  let active = $state(-1)
  let shut = $state(false)
  let composing = false

  const listing = $derived(editing && !shut && rows.length > 0)
  const byValue = $derived(new Map(rows.map((one) => [valueOf(one), one])))

  function valueOf(offer: Offer): string {
    return offer.kind === 'note' ? `${NOTE}${offer.note.path}` : offer.visit.url
  }

  function urlOf(offer: Offer): string {
    return offer.kind === 'note' ? offer.note.url : offer.visit.url
  }

  function offersFor(said: string): Offer[] {
    const pages = visited.suggest(book, said)
    const root = links.rootOf()
    if (!onnote || root === null) return pages.map((visit) => ({ kind: 'page', visit }))

    const notes = webNotesFor(
      said,
      webNotesOf(links.websitesHere, root, (key) => frecency.worth(key)),
    )
    const saved = new Set(notes.map((one) => one.url))
    const first: Offer[] = []
    const after: Offer[] = []
    for (const note of notes) {
      const offer: Offer = { kind: 'note', note }
      ;(leads(note, said, frecency.worth(noteKey(note.path)) > 0) ? first : after).push(offer)
    }
    return [
      ...first,
      ...pages
        .filter((one) => !saved.has(one.url))
        .map((visit): Offer => ({ kind: 'page', visit })),
      ...after,
    ]
  }

  $effect(() => {
    const box = field
    const face = rest()
    if (box && !editing && box.value !== face) box.value = face
  })

  function rest(): string {
    const half = held.halfTyped
    return half?.over === address ? half.value : resting
  }

  $effect(() => {
    if (!listing) return
    return untrack(() => overlays.show(() => (shut = true)))
  })

  export function take() {
    afterPress(() => {
      if (!here()) return
      field?.focus()
      if (!restored) field?.select()
      restored = false
    })
  }

  function here(): boolean {
    return field?.isConnected === true
  }

  function remember() {
    const box = field
    if (!box || !holding) return
    held.halfTyped =
      box.value !== address
        ? {
            value: box.value,
            typed,
            from: box.selectionStart ?? box.value.length,
            to: box.selectionEnd ?? box.value.length,
            over: address,
          }
        : null
  }

  let restored = false
  let holding = false

  function onFocus() {
    if (!here() || !field) return

    visited.wake(book)
    holding = true
    held.keyboard = 'address'
    editing = true
    ontyping(true)
    rows = []
    active = -1
    shut = false
    const half = held.halfTyped
    const back = half?.over === address ? half : null
    held.halfTyped = null
    restored = back !== null
    if (back) {
      field.value = back.value
      typed = back.typed
      field.setSelectionRange(back.from, back.to)
      return
    }
    field.value = address
    typed = address
    field.select()
  }

  function onBlur() {
    if (!here() || !field) return

    remember()
    if (document.hasFocus() && !pressedOn?.closest('[data-tab]')) held.keyboard = null
    holding = false
    editing = false
    ontyping(false)
    rows = []
    field.value = rest()
  }

  onMount(() => () => {
    if (holding) remember()
  })

  function finish() {
    const box = field
    if (!box) return

    const offer = visited.complete(book, typed)
    if (!offer || offer.text.length <= typed.length) return

    box.value = offer.text
    box.setSelectionRange(typed.length, offer.text.length)
  }

  function onInput(event: Event) {
    const box = field
    if (!box) return

    typed = box.value
    active = -1
    shut = false
    rows = offersFor(typed)
    remember()

    const typing = event instanceof InputEvent && event.inputType === 'insertText'
    if (!typing || composing || event.isComposing) return
    if (box.selectionStart !== box.value.length) return

    finish()
  }

  function resolved(said: string): string {
    const offer = visited.complete(book, said)
    return offer?.text === said ? offer.url : said
  }

  function move(step: 1 | -1) {
    const box = field
    if (!box) return

    let next = active + step
    if (next < -1) next = rows.length - 1
    if (next >= rows.length) next = -1
    active = next

    const row = rows[active]
    box.value = row ? shownAddress(urlOf(row)) : typed
    box.setSelectionRange(box.value.length, box.value.length)
    if (!row) finish()
  }

  function complete(): boolean {
    const box = field
    if (!box) return false
    const row = rows[active]
    const offered = box.selectionStart !== box.selectionEnd && box.selectionEnd === box.value.length
    if (!row && !offered) return false

    const text = row ? shownAddress(urlOf(row)) : box.value
    box.value = text
    box.setSelectionRange(text.length, text.length)
    typed = text
    active = -1
    rows = offersFor(typed)
    remember()
    return true
  }

  function choose(value: string, aside = false) {
    const row = byValue.get(value)
    if (row?.kind === 'note' && onnote && !aside) {
      frecency.use(noteKey(row.note.path))
      onnote(row.note.path)
      field?.blur()
      held.halfTyped = null
      return
    }
    go(row ? urlOf(row) : value, aside)
  }

  function go(said: string, aside = false) {
    onenter(said, aside, typed)
    field?.blur()
    held.halfTyped = null
  }

  function onKeydown(event: KeyboardEvent) {
    const box = field
    if (!box || event.isComposing) return

    if (listing && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
      event.preventDefault()
      move(event.key === 'ArrowDown' ? 1 : -1)
      return
    }

    const row = rows[active]
    if (listing && row?.kind === 'page' && event.key === 'Delete' && event.shiftKey) {
      event.preventDefault()
      visited.remove(book, row.visit.url)
      rows = offersFor(typed)
      active = Math.min(active, rows.length - 1)
      const next = rows[active]
      box.value = next ? shownAddress(urlOf(next)) : typed
      return
    }

    if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey) {
      if (complete()) event.preventDefault()
      return
    }

    if ((event.key === 'ArrowRight' || event.key === 'End') && !event.shiftKey) {
      typed = box.value
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      const dotted = event.ctrlKey || event.metaKey ? dotCom(typed) : null
      if (row) choose(valueOf(row), event.altKey)
      else go(dotted ?? resolved(box.value), event.altKey)
      return
    }

    if (event.key !== 'Escape') return

    event.preventDefault()
    event.stopPropagation()
    if (listing || box.value !== typed) {
      shut = true
      active = -1
      box.value = typed
      return
    }

    box.blur()
    held.halfTyped = null
  }
</script>

<div class="field">
  <input
    bind:this={field}
    class="nib-field"
    type="text"
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    autocomplete="off"
    placeholder={t('Address')}
    role="combobox"
    aria-label={t('Address')}
    aria-autocomplete="both"
    aria-expanded={listing}
    aria-controls="{id}-pages"
    aria-activedescendant={listing && active >= 0 ? `${id}-pages-${active}` : undefined}
    onfocus={onFocus}
    onblur={onBlur}
    oninput={onInput}
    onkeydown={onKeydown}
    onkeyup={() => remember()}
    onpointerup={() => remember()}
    oncompositionstart={() => (composing = true)}
    oncompositionend={() => (composing = false)}
  />

  {#if listing}
    <Suggest
      id="{id}-pages"
      label={t('Address')}
      values={rows.map(valueOf)}
      {typed}
      {active}
      shown={(value: string) => {
        const row = byValue.get(value)
        return row?.kind === 'note' ? row.note.title : shownAddress(row ? urlOf(row) : value)
      }}
      aside={(value: string) => {
        const row = byValue.get(value)
        if (row?.kind === 'note') return row.note.shown
        return row?.visit.title ?? ''
      }}
      marks={(value: string, text: string) =>
        byValue.get(value)?.kind === 'note' ? pieces(text, typed) : null}
      badge={(value: string) => (byValue.get(value)?.kind === 'note' ? t('Saved') : '')}
      lead={site}
      onchoose={(value: string) => choose(value)}
    />
  {/if}
</div>

{#snippet site(value: string)}
  {@const row = byValue.get(value)}
  {#if row?.kind === 'note'}
    <FileMark mark="web" path={row.note.path} />
  {:else}
    <FileMark mark="web" url={row ? urlOf(row) : value} />
  {/if}
{/snippet}

<style>
  .field {
    position: relative;
    flex: 1 1 8rem;
    min-width: min(7rem, 100%);
    display: flex;
  }

  .nib-field {
    flex: 1;
    min-width: 0;
  }
</style>

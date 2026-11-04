<script module lang="ts">
  /** Whether a button of the pointer is down anywhere in the window. A tab coming back
   *  builds its bar on the press of its tab, which then takes the keyboard for itself as
   *  the press goes on; the field asks for the keyboard once the press is over (#381). */
  let pressing = false
  /** What the last press landed on: a tab, which takes the keyboard from the field only on
   *  its way to another tab, or anything else, which the reader chose instead (#381). */
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

  /** `run` now, or once the press going on is over and its click with it. */
  function afterPress(run: () => void) {
    if (!pressing) {
      run()
      return
    }
    window.addEventListener('pointerup', () => setTimeout(run, 0), { once: true, capture: true })
  }
</script>

<script lang="ts">
  /** The field an address is typed into, finishing it the way a browser does.
   *
   *  One control with two faces, and one with a list under it. While it does not have
   *  the keyboard it reads `resting` - whatever the caller says, which for the bar is
   *  the whole address (#774), or what was half typed and left in it - and the moment it does it
   *  holds the whole address, selected so
   *  typing replaces it. Then it is Chrome's omnibox, in both halves; see omnibox.ts
   *  for what is offered and why:
   *
   *  * the rest of the best address is written into the field after the caret and
   *    selected, so typing on narrows it, Backspace or Delete drops it, Right or End
   *    takes it, and Enter goes where it says;
   *  * a few pages open before hang under the field, walked with the arrows, taken with
   *    Enter or a press, closed with Escape, and taken out of the history with
   *    Shift+Delete, which is how Chrome forgets one;
   *  * and the space's own websites among them, found the palette's way by their name
   *    and their address and marked as saved, which open as the note they are (#1059;
   *    see web-notes.ts). Tab takes the row the arrows are on, or what the field
   *    finished, into the field to type on from.
   *
   *  Alt+Enter goes there in a tab of its own, which is Chrome's too.
   *
   *  Nothing is offered in the middle of a composition: an input method's letters are
   *  not the reader's until the composition ends, and a completion written into them
   *  would be written into a word that is not finished being made.
   *
   *  The only field an address is typed into, so every way a tab is given one - the
   *  bar over a page, a new web note asking where it points - finishes it the same. */

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

  /** One row under the field: a page of the history, or a website of the space. */
  type Offer = { kind: 'page'; visit: Visit } | { kind: 'note'; note: WebNote }

  /** What a website's row is known by in the list, which no address can be. */
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
    /** What the field reads while nobody is typing in it. */
    resting: string
    /** What it holds the moment somebody starts: the address the tab is on. */
    address: string
    /** Which history it offers from, which is its space's; see web-data.ts. */
    book: string
    /** Somebody pressed Enter on something: an address, or words for the tab to make
     *  one of - and `aside` when it was Alt+Enter, which wants a tab of its own; `typed`
     *  is what was typed before the field finished it. */
    onenter: (said: string, aside: boolean, typed: string) => void
    ontyping: (on: boolean) => void
    /** A website of the space was chosen from the list: the tab opens that note. Left
     *  out, the list offers none - a private tab's field, which keeps to its own. */
    onnote?: ((path: string) => void) | undefined
    /** Where what was half typed waits while the field is not on screen: the tab's own
     *  page, so going to another tab and back finds it (#381). Kept in memory with the
     *  tab and not in the session, as Chrome keeps an address being typed per tab and
     *  not across a restart. */
    held?: { halfTyped: HalfTyped | null; keyboard?: 'address' | 'page' | null }
  } = $props()

  const id = $props.id()

  let field = $state<HTMLInputElement>()
  /** Whether the field itself has the keyboard, which is what swaps its two faces. */
  let editing = $state(false)
  /** What the reader typed, without whatever the field wrote after it. */
  let typed = $state('')
  let rows = $state<Offer[]>([])
  /** The row the arrows are on, or -1 for the field itself. */
  let active = $state(-1)
  /** Escape closed the list; the next letter opens it again. */
  let shut = $state(false)
  let composing = false

  const listing = $derived(editing && !shut && rows.length > 0)
  /** Each row by the value the list knows it by. */
  const byValue = $derived(new Map(rows.map((one) => [valueOf(one), one])))

  function valueOf(offer: Offer): string {
    return offer.kind === 'note' ? `${NOTE}${offer.note.path}` : offer.visit.url
  }

  function urlOf(offer: Offer): string {
    return offer.kind === 'note' ? offer.note.url : offer.visit.url
  }

  /** What was typed offered: the space's websites the palette's way, and the pages of
   *  the history, one row per place. A website found well stands first; one found only
   *  by letters spread through it goes under the pages, which agree with what the field
   *  finished the word to. */
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

  /** Puts the resting face back on a field nobody is typing in. Done by writing the
   *  value rather than by binding it: a bound value fights the keys somebody is
   *  pressing, and this is a field with two faces rather than one value. */
  $effect(() => {
    const box = field
    const face = rest()
    if (box && !editing && box.value !== face) box.value = face
  })

  /** The face of a field nobody is typing in: what was half typed into it, which Chrome's
   *  field keeps after a press somewhere else, while the tab is on the address it was
   *  typed over - and `resting` otherwise (#381). */
  function rest(): string {
    const half = held.halfTyped
    return half?.over === address ? half.value : resting
  }

  // The list is over the page, and a web tab's page is a native webview that draws
  // above every pixel of the window's own: so while it is open it is on the overlay
  // stack, which has the page look again at what is over it and cut the list out of
  // itself. See `coverOf` in WebTab.svelte.
  $effect(() => {
    if (!listing) return
    return untrack(() => overlays.show(() => (shut = true)))
  })

  /** Takes the keyboard, with the whole address selected. */
  export function take() {
    afterPress(() => {
      if (!here()) return
      field?.focus()
      if (!restored) field?.select()
      restored = false
    })
  }

  /** Whether this field is still the one on screen.
   *
   *  A focus and a blur both arrive from the browser rather than from the app, and a
   *  pane being swapped takes the keyboard off the field on its way out - so the last
   *  blur this field ever gets arrives *during* its own teardown, before any teardown
   *  of ours could have set a flag. The element's own `isConnected` is the only signal
   *  that does not depend on the order: a field out of the document is a field whose
   *  bar has gone, and reading this component's own `$derived` from there is a read of
   *  a graph Svelte has already marked inert. */
  function here(): boolean {
    return field?.isConnected === true
  }

  /** What was half typed when the keyboard left this field, where the caret was, and over
   *  which address: it comes back with the keyboard, as in Chrome's address field, while
   *  the tab is on that address - after the keyboard went to another program and back,
   *  and after the tab went and came back (#381), when this field is a new one in the
   *  tab's bar and finds it in `held` - and after a press somewhere else, which leaves
   *  the words in the field as Chrome's does. */
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

  /** Whether the last focus put half-typed words back, which `take` then leaves as they
   *  were rather than selecting. */
  let restored = false
  /** Whether the field has the keyboard as far as its own focus and blur said: plain, so
   *  the teardown reads what the last of them left rather than a graph already gone. */
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
    // Still the field's as far as its tab goes when the keyboard went to another program
    // or to a tab pressed on the way to it; not when the reader pressed something else.
    if (document.hasFocus() && !pressedOn?.closest('[data-tab]')) held.keyboard = null
    holding = false
    editing = false
    ontyping(false)
    rows = []
    field.value = rest()
  }

  // The tab going while its field has the keyboard - Ctrl+Tab typed into it - takes the
  // field away before any blur this component could hear: what it held is kept here. Only
  // then: a field the reader had already left kept their words as it was left.
  onMount(() => () => {
    if (holding) remember()
  })

  /** Writes the rest of the best address after what was typed, selected. */
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

    // Only a letter typed at the end: a deletion is somebody taking the offer away,
    // and offering it again would undo the key they pressed; a paste and a letter in
    // the middle are an address being edited rather than typed.
    const typing = event instanceof InputEvent && event.inputType === 'insertText'
    if (!typing || composing || event.isComposing) return
    if (box.selectionStart !== box.value.length) return

    finish()
  }

  /** Where Enter goes from what the field says: the address it was finished to, when
   *  it says exactly that - which a site typed out in full also is, so `localhost:1420`
   *  goes back to the `http:` it was on rather than to a guess - and otherwise the words
   *  themselves, for the tab to make an address or a search of. */
  function resolved(said: string): string {
    const offer = visited.complete(book, said)
    return offer?.text === said ? offer.url : said
  }

  /** The arrows, down the list and back up to the field. The field reads the row the
   *  arrows are on, which is what a browser does, and what was typed when they come
   *  back. */
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

  /** Tab: what the field reads becomes what was typed, to go on from - the row the
   *  arrows are on, or the rest of the address the field wrote after the caret. False
   *  where there is nothing to take, so the key moves on as Tab does. */
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

  /** A row chosen: a website opens as its note, a page goes where it is. */
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
    // What was typed beside where it went: a host the field completed may still fall
    // back to plain http; see upgrade.ts.
    onenter(said, aside, typed)
    field?.blur()
    // Gone where it was going: nothing is left half typed.
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
    // Out of the history; a website is a file of the space, and stays.
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

    // Right and End take what the field offered: it is typed from here on.
    if ((event.key === 'ArrowRight' || event.key === 'End') && !event.shiftKey) {
      typed = box.value
      return
    }

    if (event.key === 'Enter') {
      event.preventDefault()
      // Ctrl+Enter is the `.com` press every browser has, and it is about what was
      // typed rather than what the field offered after it; see `dotCom` in typed.ts.
      const dotted = event.ctrlKey || event.metaKey ? dotCom(typed) : null
      if (row) choose(valueOf(row), event.altKey)
      else go(dotted ?? resolved(box.value), event.altKey)
      return
    }

    if (event.key !== 'Escape') return

    // The layer above the bar has its own Escape; a field being typed in keeps this
    // one. The first press takes back what the field offered, the list with it, and
    // the second gives the keyboard back. See overlays.ts.
    event.preventDefault()
    event.stopPropagation()
    if (listing || box.value !== typed) {
      shut = true
      active = -1
      box.value = typed
      return
    }

    // The second Escape gives the address back, and what was typed with it.
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

<!-- The site's mark in front of each page offered, the one its tab wore: Chrome's
     omnibox rows, and the first thing an eye finds in a list of addresses. -->
{#snippet site(value: string)}
  {@const row = byValue.get(value)}
  {#if row?.kind === 'note'}
    <FileMark mark="web" path={row.note.path} />
  {:else}
    <FileMark mark="web" url={row ? urlOf(row) : value} />
  {/if}
{/snippet}

<style>
  /* The field takes whatever the glyphs beside it leave, and never less than can be
     read: in a narrow pane it is the bar that gives way, onto a second line, and not
     the field, which went to nothing behind its own padding. The list hangs from it,
     so it is the box the list is placed against. */
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

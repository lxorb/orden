<script lang="ts">
  import type { FileRef, Member, Poll } from '@orden/chats'
  import { ASK_EVERYONE_PAST } from '@orden/chats/limits'
  import { createEditor, EditorView, modeEffects, setNoteIndex } from '@orden/editor'
  import { onMount, untrack } from 'svelte'
  import { chooseFiles } from '../../../ui-controls/src/api'
  import { localDate, localNumber, dur, fade, scale, insideSpace, afterQuiet } from '../../../platform/src/api'
  import { DIVIDER, longPress, menu } from '../../../ui-kit/src/api'
  import { Avatar } from '../../../faces/src/api'
  import { Attachments } from './attachments.svelte'
  import type { Scheduled } from '../shapes'
  import { firstLine } from './body'
  import { host as chatsHost } from './host'
  import type { ChatPage } from './chat.svelte'
  import { asFile, enterDoes, mentionAt, mentionChoices, mentionText, ordenAsked, type Special } from './compose'
  import { Glyph } from '../../../chat-kit/src/api'
  import MentionMenu from './MentionMenu.svelte'
  import NoteReach from './NoteReach.svelte'
  import { faceOf, nameOf } from './people'
  import Recorder from './Recorder.svelte'
  import { store } from './source.svelte'
  import { tip } from './tips.svelte'
  import { laterTimes } from './when'

  const {
    page,
    space,
    path,
    parent,
    onrows,
    onescape,
    onpicker,
    onpoll,
  }: {
    page: ChatPage
    space: string | null
    path: string | null
    parent?: string
    onrows?: () => void
    onescape?: () => void
    onpicker: (from: HTMLElement, insert: (emoji: string) => void) => void
    onpoll?: (send: (poll: Poll) => void) => void
  } = $props()
  const draftKey = $derived(parent ? `${page.id}/${parent}` : page.id)
  let host = $state<HTMLDivElement>()
  let editor = $state<EditorView | null>(null)
  let empty = $state(true)
  let recording = $state(false)
  let alsoToChat = $state(false)
  let mention = $state<{ from: number; query: string } | null>(null)
  let mentionLit = $state(0)
  const attachments = new Attachments()
  let offered: string | null = null
  let dropped = $state<string | null>(null)
  function linkedNote(words: string): string | null {
    const target = /\[\[([^\]|#^]+)/.exec(words)?.[1]?.trim()
    const root = chatsHost().rootHolding(path)
    const found = target ? chatsHost().linkTarget(path, target) : null
    return found && root ? insideSpace(root, found) : null
  }
  const keep = afterQuiet(() => {
    if (!editor) return
    const words = editor.state.doc.toString()
    dropped = linkedNote(words) ?? (words.trim() ? offered : null)
    store().keepDraft(draftKey, words)
  }, 600)
  const aside = $derived(parent ? null : page.aside)
  const choices = $derived(mention ? mentionChoices(mention.query, page.members, page.me, mention.from === 0) : [])
  onMount(() => {
    if (!host) return
    const notes = chatsHost().noteIndex(path)
    const openNote = chatsHost().noteOpener(path)
    const writeLink = chatsHost().writeLink()
    const keys = chatsHost().editorKeys()
    const made = createEditor({
      parent: host,
      doc: store().draft(untrack(() => draftKey)),
      onChange: (doc) => {
        empty = doc.length === 0
        if (doc.length) page.view.typed(parent)
        keep()
      },
      onSelection: (one) => {
        const caret = one.state.selection.main.head
        const found = mentionAt(one.state.sliceDoc(Math.max(0, caret - 64), caret), Math.min(64, caret))
        mention = found ? { from: caret - found.query.length - 1, query: found.query } : null
        mentionLit = 0
      },
      ...(notes ? { notes } : {}),
      ...(openNote ? { openNote } : {}),
      ...(writeLink ? { writeLink } : {}),
      openLink: (href, press) => chatsHost().followHref(href, press),
      ...(keys ? { shortcuts: keys } : {}),
      trustedMarkup: false,
    })
    const typing = chatsHost().editorModes()
    if (typing) made.dispatch({ effects: modeEffects(typing) })
    empty = made.state.doc.length === 0
    editor = made
    const take = (offer: { note?: string } | null) => {
      offered = offer?.note ?? null
      if (offered) dropped = offered
    }
    take(store().takeOffer(page.id, parent))
    const unoffer = store().offers((offer) => {
      if (offer.chat !== page.id || offer.parent !== parent) return
      take(store().takeOffer(page.id, parent))
      setText(offer.text)
      focus()
    })
    return () => {
      unoffer()
      keep.cancel()
      store().keepDraft(draftKey, made.state.doc.toString())
      made.destroy()
      attachments.clear()
    }
  })
  $effect(() => {
    const index = chatsHost().noteIndex(path)
    if (editor && index) setNoteIndex(editor, index)
  })
  $effect(() => {
    if (aside) untrack(focus)
  })
  function text(): string {
    return editor?.state.doc.toString() ?? ''
  }
  function setText(words: string) {
    if (!editor) return
    editor.dispatch({
      changes: { from: 0, to: editor.state.doc.length, insert: words },
      selection: { anchor: words.length },
    })
  }
  export function focus(): void {
    editor?.focus()
  }
  export function addFiles(files: readonly File[]): void {
    attachments.add(files)
    focus()
  }
  export function addNotes(paths: readonly string[]): void {
    const index = chatsHost().noteIndex(path)
    const write = chatsHost().writeLink()
    if (!index || !write) return
    void import('@orden/editor/note-links').then(({ noteLinks }) => insert(`${noteLinks(index, paths, write)} `))
  }
  export function insert(words: string) {
    if (!editor) return
    editor.dispatch(editor.state.replaceSelection(words))
    editor.focus()
  }
  async function send() {
    let words = text()
    if (!attachments.ready) return
    if (!words.trim() && !attachments.refs.length) return
    const long = asFile(words, 'Text')
    if (long) {
      if (!(await attachments.took(long))) return
      setText('')
      words = ''
    }
    const question = __AI__ ? ordenAsked(words) : null
    if (question !== null && !attachments.refs.length) {
      setText('')
      store().keepDraft(draftKey, '')
      await chatsHost().askOrden?.(page.id, question, parent)
      return
    }
    if (/(?:^|\s)@(?:here|everyone)\b/.test(words) && page.members.length > ASK_EVERYONE_PAST) {
      const { prompt } = await import('../../../ui-kit/src/api')
      const said = await prompt.choose({
        title: 'Send',
        detail: words.slice(0, 200),
        options: [
          { id: 'send', label: 'Send', primary: true },
          { id: 'no', label: 'Cancel' },
        ],
      })
      if (said !== 'send') return
    }
    page.post(words, { ...(parent ? { parent, alsoToChat } : {}), files: attachments.refs })
    offered = null
    dropped = null
    attachments.clear()
    setText('')
    store().keepDraft(draftKey, '')
    alsoToChat = false
  }
  function sendFile(file: FileRef) {
    page.post('', { ...(parent ? { parent } : {}), files: [file] })
  }
  function pick(choice: Member | Special) {
    if (!editor || !mention) return
    const caret = editor.state.selection.main.head
    const words = mentionText(choice)
    editor.dispatch({
      changes: { from: mention.from, to: caret, insert: words },
      selection: { anchor: mention.from + words.length },
    })
    mention = null
    editor.focus()
  }
  function onKey(event: KeyboardEvent) {
    if (!editor || event.isComposing || recording) return
    const spend = () => {
      event.preventDefault()
      event.stopPropagation()
    }
    const popup = !!editor.dom.querySelector('.cm-tooltip-autocomplete')
    const mod = event.ctrlKey || event.metaKey
    if (mention && choices.length && !popup) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        spend()
        const by = event.key === 'ArrowDown' ? 1 : -1
        mentionLit = (mentionLit + by + choices.length) % choices.length
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        spend()
        const choice = choices[mentionLit]
        if (choice) pick(choice)
        return
      }
      if (event.key === 'Escape') {
        spend()
        mention = null
        return
      }
    }
    if (popup) return
    const caret = editor.state.selection.main.head
    if (event.key === 'Enter') {
      const does = enterDoes(editor.state.sliceDoc(0, caret), { shift: event.shiftKey, mod })
      if (does === 'editor') return
      spend()
      if (does === 'line') insert('\n')
      else void send()
      return
    }
    if (event.key === 'ArrowUp' && empty && !aside && !parent) {
      const last = page.lastOwn()
      if (last) {
        spend()
        page.editing = { id: last.id, replies: false }
      }
      return
    }
    if (event.key === 'Escape') {
      spend()
      if (aside) page.aside = null
      else if (page.editing) page.editing = null
      else onescape?.()
      return
    }
    if (mod && !event.shiftKey && event.key.toLowerCase() === 'z' && empty) {
      spend()
      void page.unsend().then((back) => {
        if (back !== null && text() === '') setText(back)
      })
      return
    }
    if (event.key === 'Tab' && !event.shiftKey && empty && onrows) {
      spend()
      onrows()
      return
    }
    if (chatsHost().pressed('chat.record', event)) {
      spend()
      recording = true
    }
  }
  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])]
    const long = files.length ? null : asFile(event.clipboardData?.getData('text/plain') ?? '', 'Text')
    if (!files.length && !long) return
    event.preventDefault()
    event.stopPropagation()
    attachments.add(long ? [long] : files)
  }
  function attach(event: MouseEvent) {
    menu.show(event, [
      {
        label: 'File',
        run: () => void chooseFiles({ multiple: true }).then((files) => attachments.add(files)),
      },
      ...(onpoll && !parent ? [DIVIDER, { label: 'Poll', run: () => onpoll((poll) => page.post('', { poll })) }] : []),
    ])
  }
  function later(event: MouseEvent) {
    const words = text()
    if (!words.trim()) return
    const times = laterTimes(Date.now())
    menu.show(
      event,
      times.map((when) => ({
        label: localDate(when, { weekday: 'long', hour: 'numeric', minute: '2-digit' }),
        run: () => {
          page.schedule(words, when)
          setText('')
          store().keepDraft(draftKey, '')
          setTimeout(() => void lookWaiting(), 300)
        },
      })),
      { title: 'Send later' },
    )
  }
  let waiting = $state.raw<Scheduled[]>([])
  async function lookWaiting() {
    if (!parent)
      waiting = await store()
        .scheduled(page.id)
        .catch(() => [])
  }
  onMount(() => void lookWaiting())
  function showWaiting(event: MouseEvent) {
    menu.show(
      event,
      waiting.map((one) => ({
        label: `${localDate(one.sendAt, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}  ${firstLine(one.post.body)}`,
        run: () => undefined,
        more: () =>
          Promise.resolve([
            {
              label: 'Delete',
              danger: true,
              run: () => {
                page.remove(one.post.message)
                waiting = waiting.filter((held) => held.id !== one.id)
              },
            },
          ]),
      })),
      { title: 'Scheduled' },
    )
  }
  const typing = $derived(page.view.presence.typing.filter((one) => one.who !== page.me && one.parent === parent))
</script>

<div class="composer" onkeydowncapture={onKey} onpastecapture={onPaste}>
  {#if mention && choices.length}
    <MentionMenu {choices} lit={mentionLit} members={page.members} {space} onpick={pick} />
  {/if}

  {#if aside}
    <div class="aside" transition:fade={{ duration: dur(100) }}>
      <Glyph name="quote" />
      <span class="aside-words">
        <strong>{nameOf(aside.message.author, page.members, space)}</strong>
        {aside.message.body.split('\n')[0]}
      </span>
      <button type="button" class="orden-glyph" aria-label="Cancel" onclick={() => (page.aside = null)}
        ><Glyph name="close" /></button
      >
    </div>
  {/if}

  {#if dropped && !parent}
    <NoteReach chat={page.id} path={dropped} members={page.members} {space} />
  {/if}

  {#if attachments.list.length}
    <div class="chips">
      {#each attachments.list as one (one.id)}
        <span
          class="chip"
          class:failed={one.failed}
          class:busy={!one.ref && !one.failed}
          in:scale={{ start: 0.85, duration: dur(150) }}
        >
          {#if one.thumb}
            <img src={one.thumb} alt="" draggable="false" />
          {:else}
            <Glyph name={one.type.startsWith('audio/') ? 'mic' : 'file'} />
          {/if}
          <span class="chip-name">{one.name}</span>
          <button type="button" class="chip-off" aria-label="Remove" onclick={() => attachments.remove(one.id)}
            ><Glyph name="close" /></button
          >
        </span>
      {/each}
    </div>
  {/if}

  <div class="box orden-field">
    {#if recording}
      <Recorder onsend={sendFile} ondone={() => ((recording = false), focus())} />
    {:else}
      <button
        type="button"
        class="tool"
        aria-label="Attach something"
        use:tip={() => 'Attach something'}
        onclick={attach}><Glyph name="attach" /></button
      >
      <div class="field">
        <div class="editor" bind:this={host}></div>
        {#if empty}
          <span class="placeholder" aria-hidden="true"
            >{parent ? 'Reply' : page.entry?.name ? `Message ${page.entry.name}` : ''}</span
          >
        {/if}
      </div>
      <button
        type="button"
        class="tool"
        aria-label="Emoji"
        use:tip={() => 'Emoji'}
        onclick={(event) => onpicker(event.currentTarget, insert)}><Glyph name="smile" /></button
      >
      {#if empty && !attachments.list.length && !aside}
        <button
          type="button"
          class="tool"
          aria-label="Voice message"
          {@attach chatsHost().keyTip('Voice message', 'chat.record')}
          onclick={() => (recording = true)}
          in:scale={{ start: 0.7, duration: dur(130) }}><Glyph name="mic" /></button
        >
      {:else}
        {@const canLater = !parent && !aside && !attachments.list.length}
        <button
          type="button"
          class="send"
          aria-label="Send"
          disabled={!attachments.ready}
          use:tip={() => (canLater ? 'Send, right-click to send later' : 'Send')}
          onclick={() => void send()}
          oncontextmenu={(event) => {
            if (!canLater) return
            event.preventDefault()
            later(event)
          }}
          use:longPress={(event) => {
            if (canLater) later(event)
          }}
          in:scale={{ start: 0.7, duration: dur(130) }}><Glyph name="send" /></button
        >
      {/if}
    {/if}
  </div>

  <div class="foot">
    {#if waiting.length}
      <button type="button" class="waiting" aria-label="Scheduled" onclick={showWaiting}>
        <Glyph name="clock" />
        {localNumber(waiting.length)}
      </button>
    {/if}
    {#if parent}
      <button
        type="button"
        class="also"
        role="switch"
        aria-checked={alsoToChat}
        onclick={() => (alsoToChat = !alsoToChat)}
      >
        <span class="tick" class:on={alsoToChat} aria-hidden="true"></span>
        Also send to {page.entry?.name ?? ''}
      </button>
    {/if}
    {#if typing.length}
      <span class="typing" aria-label={typing.map((one) => nameOf(one.who, page.members, space)).join(', ')}>
        {#each typing.slice(0, 3) as one (one.who)}
          <Avatar face={faceOf(one.who, page.members, space)} size={16} />
        {/each}
        <span class="dots" aria-hidden="true"><i></i><i></i><i></i></span>
      </span>
    {/if}
  </div>
</div>

<style>
  .composer {
    position: relative;
    flex: none;
    padding: 0 var(--space-4) 0;
  }
  .box {
    align-items: flex-end;
    gap: var(--space-1);
    min-height: 42px;
    padding: 4px;
  }
  .field {
    position: relative;
    flex: 1;
    min-width: 0;
    align-self: center;
  }
  .editor :global(.cm-editor) {
    height: auto;
    max-height: 33vh;
    background: none;
    font-size: var(--text-row);
  }
  .editor :global(.cm-editor.cm-focused) {
    outline: none;
  }
  .editor :global(.cm-scroller) {
    overflow-y: auto;
    font-family: var(--font-ui);
    line-height: 1.45;
  }
  .editor :global(.cm-content:is(#write, .orden-write)) {
    max-width: none;
    margin: 0;
    padding: 5px 0;
    min-height: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }
  .editor :global(.cm-line) {
    padding: 0 var(--space-1);
  }
  .editor :global(.cm-activeLine) {
    background: none;
  }
  .placeholder {
    position: absolute;
    top: 5px;
    left: var(--space-1);
    color: var(--muted);
    pointer-events: none;
    font-size: var(--text-row);
    line-height: 1.45;
  }
  .tool,
  .send {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
  }
  .tool {
    --glyph-size: 18px;
    flex: none;
    background: none;
    color: var(--muted);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .tool:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }
  .send {
    --glyph-size: 16px;
    background: var(--accent);
    color: var(--accent-ink);
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }
  .send:active:not(:disabled) {
    transform: scale(0.92);
  }
  @media (hover: hover) {
    .send:hover:not(:disabled) {
      background: var(--accent-hover);
    }
  }
  .aside {
    --glyph-size: 14px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-1);
    padding: 0 0 0 var(--space-3);
    border-inline-start: 2px solid var(--accent);
    color: var(--muted);
    font-size: var(--text-sm);
  }
  .aside-words {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .aside strong {
    color: var(--text-strong);
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-bottom: var(--space-1);
  }
  .chip {
    --glyph-size: 16px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 220px;
    height: 40px;
    padding: 4px 4px 4px 4px;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    font-size: var(--text-sm);
  }
  .chip img {
    width: 32px;
    height: 32px;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }
  .chip.busy img,
  .chip.busy .chip-name {
    opacity: 0.6;
    animation: ghost 1.4s var(--ease-in-out) infinite;
  }
  @keyframes ghost {
    50% {
      opacity: 0.35;
    }
  }
  .chip.failed {
    border-color: var(--danger);
  }
  .chip-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip-off {
    --glyph-size: 12px;
    display: grid;
    place-items: center;
    width: 20px;
    height: 20px;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--muted);
  }
  .foot {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-height: 22px;
    padding: 2px var(--space-1);
    color: var(--muted);
    font-size: var(--text-xs);
  }
  .waiting,
  .also {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
  }
  .waiting {
    --glyph-size: 12px;
    gap: 4px;
    font-variant-numeric: tabular-nums;
  }
  .tick {
    width: 12px;
    height: 12px;
    border: 1px solid var(--line-strong);
    border-radius: 3px;
    transition: background var(--dur-fast) var(--ease-out);
  }
  .tick.on {
    border-color: var(--accent);
    background: var(--accent);
  }
  .typing {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-inline-start: auto;
  }
  .dots {
    display: inline-flex;
    gap: 2px;
    margin-inline-start: 4px;
  }
  .dots i {
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: var(--muted);
    animation: bounce 1.2s var(--ease-in-out) infinite;
  }
  .dots i:nth-child(2) {
    animation-delay: 0.15s;
  }
  .dots i:nth-child(3) {
    animation-delay: 0.3s;
  }
  @keyframes bounce {
    30% {
      transform: translateY(-3px);
      opacity: 1;
    }
    0%,
    60%,
    100% {
      opacity: 0.4;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .dots i,
    .chip.busy img,
    .chip.busy .chip-name {
      animation: none;
    }
  }
</style>

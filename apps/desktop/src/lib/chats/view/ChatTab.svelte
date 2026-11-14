<script lang="ts">
  import { chatOf, type FileRef, type Message, type Poll } from '@orden/chats'
  import { onDestroy, untrack } from 'svelte'
  import { carriedFiles, carriesFiles, draggedTab, dropOver, isTreeDrag } from '../../drag-paths'
  import { pages } from '../../web-tab/pages.svelte'
  import EmojiPicker from '../../emoji/EmojiPicker.svelte'
  import { shortcuts } from '../../shortcuts.svelte'
  import { samePath } from '../../platform/src/api'
  import { viewport } from '../../viewport.svelte'
  import { type Tab, workspace } from '../../workspace.svelte'
  import { ChatPage } from './chat.svelte'
  import ChatHead from './ChatHead.svelte'
  import Composer from './Composer.svelte'
  import Float from './Float.svelte'
  import Glyph from './Glyph.svelte'
  import Lightbox from './Lightbox.svelte'
  import MembersPanel from './MembersPanel.svelte'
  import { membersOpen } from './members-open.svelte'
  import { isPicture, isVideo } from './media'
  import { onScreen } from '../on-screen'
  import { chatName, hearJumps, takeJump } from './open'
  import type { Box } from './place'
  import PollSheet from './PollSheet.svelte'
  import Replies from './Replies.svelte'
  import { store } from './source.svelte'
  import Timeline from './Timeline.svelte'
  import Tip from './Tip.svelte'

  const { tab }: { tab: Tab } = $props()

  const NARROWEST_BESIDE = 640

  let page = $state<ChatPage | null>(null)
  let missing = $state(false)
  let width = $state(0)
  let timeline = $state<{
    toNew: () => void
    toBottom: () => Promise<void>
    focusRows: () => void
  }>()
  let composer = $state<{
    focus: () => void
    addFiles: (files: readonly File[]) => void
    addNotes: (paths: readonly string[]) => void
    insert: (words: string) => void
  }>()
  let picking = $state<{ at: Box; pick: (emoji: string) => void } | null>(null)
  let looking = $state<{ files: FileRef[]; start: number } | null>(null)
  let polling = $state<((poll: Poll) => void) | null>(null)
  let dropping = $state(false)
  let sheetFor = $state<string | null>(null)

  const space = $derived(page?.entry?.space ?? null)
  const lentName = $derived(tab.note.shared ? chatName(tab.note.name) : null)
  const phone = $derived(viewport.device === 'phone')
  const narrow = $derived(phone || (width > 0 && width < NARROWEST_BESIDE))
  const membersShown = $derived(
    !!page &&
      (narrow ? sheetFor === page.id : membersOpen.shown(page.id)) &&
      !(phone && page.replying),
  )

  function toggleMembers() {
    if (!page) return
    if (narrow) sheetFor = sheetFor === page.id ? null : page.id
    else membersOpen.toggle(page.id)
  }

  $effect(() => {
    const path = tab.path
    const lent = tab.note.shared ? (chatOf(tab.note.text)?.chat ?? null) : null
    if ((!path && !lent) || !store().ready) return
    untrack(() => {
      void (path ? store().chatAt(path) : Promise.resolve(lent)).then((id) => {
        missing = !id
        if (!id || page?.id === id) return
        page?.close()
        page = new ChatPage(id)
      })
    })
  })

  function jumpWaiting() {
    if (!page?.ready || !tab.path) return
    const message = takeJump(tab.path)
    if (message) void page.jump(message)
  }

  $effect(() => {
    if (page?.ready) untrack(jumpWaiting)
  })

  $effect(() =>
    hearJumps((path) => {
      if (tab.path && samePath(path, tab.path)) jumpWaiting()
    }),
  )

  $effect(() => {
    const id = page?.id
    if (id) return onScreen(id)
  })

  $effect(() =>
    store().offers((offer) => {
      if (page?.id === offer.chat && offer.parent) page.replying = offer.parent
    }),
  )

  onDestroy(() => page?.close())

  function boxOf(element: Element): Box {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }

  function reactPicker(message: Message, from: HTMLElement) {
    picking = { at: boxOf(from), pick: (emoji) => page?.react(message, emoji) }
  }

  function composePicker(from: HTMLElement, insert: (emoji: string) => void) {
    picking = { at: boxOf(from), pick: insert }
  }

  function openFiles(message: Message, index: number) {
    const shown = message.files.filter((one) => isPicture(one) || isVideo(one))
    looking = { files: shown, start: index }
  }

  function onKey(event: KeyboardEvent) {
    if (!page) return
    if (shortcuts.pressed('chat.jump-new', event)) {
      event.preventDefault()
      event.stopPropagation()
      timeline?.toNew()
    } else if (shortcuts.pressed('chat.search', event)) {
      event.preventDefault()
      event.stopPropagation()
      page.search()
    } else if (shortcuts.pressed('chat.members', event)) {
      event.preventDefault()
      event.stopPropagation()
      toggleMembers()
    }
  }

  function dragging(event: DragEvent) {
    if (!carriesFiles(event.dataTransfer) && !isTreeDrag(event.dataTransfer)) return
    event.preventDefault()
    dropping = true
  }

  function dropped(event: DragEvent) {
    dropping = false
    const notes = workspace.carriedNotes(event.dataTransfer)
    if (notes.length) {
      event.preventDefault()
      composer?.addNotes(notes)
      return
    }
    const web = workspace.tabs.find((one) => one.id === draggedTab(event.dataTransfer))
    const address = web && (pages.addressOf(web.id) ?? web.address ?? workspace.webAddressOf(web))
    if (address) {
      event.preventDefault()
      composer?.insert(`${address} `)
      return
    }
    const files = [...(event.dataTransfer?.files ?? [])]
    const reading = files.length ? null : carriedFiles.read(event.dataTransfer)
    if (!files.length && !reading) return
    event.preventDefault()
    if (files.length) composer?.addFiles(files)
    void reading?.then((read) => {
      if (read.length) composer?.addFiles(read)
    })
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="chat-tab"
  class:dropping
  data-chat-drop={tab.id}
  bind:clientWidth={width}
  onkeydowncapture={onKey}
  use:dropOver={dragging}
  ondragleave={(event) => {
    if (event.currentTarget === event.target) dropping = false
  }}
  ondrop={dropped}
>
  {#if page}
    {@const open = page}
    <div class="main" class:hidden={phone && open.replying !== null}>
      <ChatHead
        page={open}
        {space}
        named={lentName}
        membersOn={membersShown}
        onmembers={toggleMembers}
      />
      {#if open.ready}
        <Timeline
          bind:this={timeline}
          page={open}
          {space}
          onreply={(message: Message) => (open.replying = message.id)}
          onquote={(message: Message) => {
            open.aside = { kind: 'quote', message }
            composer?.focus()
          }}
          onedit={(message: Message) => (open.aside = { kind: 'edit', message })}
          onpicker={reactPicker}
          onfiles={openFiles}
          oncompose={() => composer?.focus()}
        />
      {:else}
        <div class="waiting"></div>
      {/if}
      {#if open.view.role !== 'read'}
        <Composer
          bind:this={composer}
          page={open}
          {space}
          path={tab.path}
          onrows={() => timeline?.focusRows()}
          onescape={() => void timeline?.toBottom()}
          onpicker={composePicker}
          onpoll={(send: (poll: Poll) => void) => (polling = send)}
        />
      {/if}
    </div>
    {#if open.replying}
      {#key open.replying}
        <Replies
          page={open}
          parent={open.replying}
          {space}
          path={tab.path}
          width={phone ? width : Math.min(420, Math.max(320, width * 0.36))}
          onclose={() => {
            open.replying = null
            composer?.focus()
          }}
          onpicker={composePicker}
          onfiles={openFiles}
        />
      {/key}
    {/if}
    {#if membersShown}
      <MembersPanel
        page={open}
        {space}
        sheet={narrow}
        onmention={(words: string) => composer?.insert(words)}
        onclose={() => {
          if (narrow) sheetFor = null
          else membersOpen.set(open.id, false)
          composer?.focus()
        }}
      />
    {/if}
  {:else if missing}
    <p class="missing"><Glyph name="hash" /></p>
  {/if}
</div>

<Float at={picking?.at ?? null} end label="Emoji" onclose={() => (picking = null)}>
  <EmojiPicker
    onpick={(emoji: string) => {
      picking?.pick(emoji)
      picking = null
    }}
  />
</Float>

{#if looking && page}
  <Lightbox
    chat={page.id}
    files={looking.files}
    start={looking.start}
    onclose={() => (looking = null)}
  />
{/if}

{#if polling}
  <PollSheet
    onsend={(poll: Poll) => {
      polling?.(poll)
      polling = null
    }}
    onclose={() => (polling = null)}
  />
{/if}

<Tip />

<style>
  .chat-tab {
    position: relative;
    display: flex;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: var(--bg);
    transition: box-shadow var(--dur-fast) var(--ease-out);
  }

  .chat-tab.dropping {
    box-shadow: inset 0 0 0 2px var(--accent);
  }

  .main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    padding-bottom: var(--inset-bottom);
  }

  .main.hidden {
    display: none;
  }

  .chat-tab :global(.replies) {
    flex: none;
    width: min(420px, max(320px, 36%));
  }

  :global([data-touch]) .chat-tab :global(.replies) {
    flex: 1;
    width: auto;
    border: none;
  }

  .waiting {
    flex: 1;
  }

  .missing {
    --glyph-size: 32px;
    margin: auto;
    color: var(--muted);
    opacity: 0.4;
  }
</style>

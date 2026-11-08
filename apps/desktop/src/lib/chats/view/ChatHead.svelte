<script lang="ts">
  import type { Message, Notify } from '@orden/chats'
  import { may } from '@orden/chats'
  import { LONGEST_TOPIC } from '@orden/chats/limits'
  import { amount, t } from '../../i18n.svelte'
  import Avatar from '../../people/Avatar.svelte'
  import Bell from '../Bell.svelte'
  import { people } from '../../people/people.svelte'
  import { shortcuts } from '../../shortcuts.svelte'
  import type { ChatPage } from './chat.svelte'
  import Float from './Float.svelte'
  import ChatMark from './ChatMark.svelte'
  import Glyph from './Glyph.svelte'
  import { firstLine } from './body'
  import { accountOf, faceOf, nameOf } from './people'
  import type { Box } from './place'
  import { store } from './source.svelte'
  import { tip } from './tips.svelte'
  import { menu } from '../../menu.svelte'
  import { remoteOf } from '../remotes'
  import { conversationMenu } from './manage'
  import type { Hit } from '../api'

  const {
    page,
    space,
    named = null,
    membersOn = false,
    onmembers,
  }: {
    page: ChatPage
    space: string | null
    named?: string | null
    membersOn?: boolean
    onmembers: () => void
  } = $props()

  let writing = $state(false)
  let topic = $state('')
  let showing = $state<{ what: 'pins' | 'found'; at: Box } | null>(null)
  let looking = $state('')
  let found = $state.raw<Hit[]>([])
  let pinned = $state.raw<Message[]>([])

  const meta = $derived(page.view.meta)
  const canTopic = $derived(may(page.view.role, 'topic', meta.posting) && page.can.topic)
  const service = $derived(page.service)
  const remote = $derived(service ? remoteOf(page.id) : null)
  const conversation = $derived(
    service ? (remote?.conversation(service.conversation) ?? null) : null,
  )
  const managing = $derived(remote && conversation ? conversationMenu(remote, conversation) : [])

  async function lookFor(words: string) {
    const asked = words.trim()
    found = asked
      ? await store()
          .search(asked, page.id)
          .catch(() => [])
      : []
  }

  function search(element: Element) {
    if (!service) {
      page.search()
      return
    }
    looking = ''
    found = []
    showing = { what: 'found', at: boxOf(element) }
  }
  const ids = $derived(
    page.members.flatMap((one) => {
      const id = accountOf(one.who)
      return id ? [id] : []
    }),
  )
  const members = $derived(
    [...page.members].sort((a, b) => {
      const rank = (who: typeof a.who) => {
        const id = accountOf(who)
        const presence = id ? people.of(id)?.presence : undefined
        return presence === 'active' ? 0 : presence === 'away' ? 1 : 2
      }
      return (
        rank(a.who) - rank(b.who) ||
        nameOf(a.who, page.members, space).localeCompare(nameOf(b.who, page.members, space))
      )
    }),
  )

  $effect(() => {
    const list = ids
    return people.watch(() => list)
  })

  function boxOf(element: Element): Box {
    const box = element.getBoundingClientRect()
    return { left: box.left, top: box.top, right: box.right, bottom: box.bottom }
  }

  async function showPins(element: Element) {
    pinned = await page.pinned()
    showing = { what: 'pins', at: boxOf(element) }
  }

  function startTopic() {
    if (!canTopic) return
    topic = meta.topic
    writing = true
  }

  function keepTopic() {
    writing = false
    if (topic.trim() !== meta.topic) page.topic(topic.trim())
  }
</script>

<header class="head">
  <span class="mark"
    >{#if service}<svg viewBox="0 0 24 24" aria-label={service.name} role="img" class="service"
        ><path d={service.icon} /></svg
      >{:else}<ChatMark path={page.entry?.path} />{/if}</span
  >
  <h2 class="name">{page.entry?.name ?? named ?? ''}</h2>
  {#if writing}
    <!-- svelte-ignore a11y_autofocus -->
    <input
      class="topic-field"
      bind:value={topic}
      maxlength={LONGEST_TOPIC}
      aria-label={t('Topic')}
      autofocus
      onblur={() => {
        if (writing) keepTopic()
      }}
      onkeydown={(event) => {
        if (event.key === 'Enter') keepTopic()
        else if (event.key === 'Escape') {
          event.stopPropagation()
          writing = false
        }
      }}
    />
  {:else}
    <button
      type="button"
      class="topic"
      class:empty={!meta.topic}
      disabled={!canTopic}
      onclick={startTopic}>{meta.topic || (canTopic ? t('Topic') : '')}</button
    >
  {/if}
  <span class="grow"></span>
  {#if page.can.members}
    <button
      type="button"
      class="people"
      class:on={membersOn}
      aria-label={t('Members')}
      aria-pressed={membersOn}
      use:tip={() => shortcuts.tooltip(t('Members'), 'chat.members')}
      onclick={onmembers}
    >
      <span class="faces" aria-hidden="true">
        {#each members.slice(0, 3) as one (one.who)}
          <span class="face"><Avatar face={faceOf(one.who, page.members, space)} size={20} /></span>
        {/each}
      </span>
      <span class="count">{amount(page.view.members.filter((one) => !one.gone).length)}</span>
    </button>
  {/if}
  {#if page.can.pin}
    <button
      type="button"
      class="orden-glyph"
      aria-label={t('Pinned')}
      use:tip={() => t('Pinned')}
      onclick={(event) => void showPins(event.currentTarget)}><Glyph name="pin" /></button
    >
  {/if}
  {#if page.can.mute}
    <Bell
      notify={page.entry?.notify ?? null}
      mutedUntil={page.entry?.mutedUntil ?? null}
      members={page.entry?.members ?? page.members.length}
      onchange={(notify: Notify | null, mutedUntil: number | null) =>
        void store().notifyFor(page.id, notify, mutedUntil)}
    />
  {/if}
  {#if page.can.search}
    <button
      type="button"
      class="orden-glyph"
      aria-label={t('Search this chat')}
      use:tip={() => shortcuts.tooltip(t('Search this chat'), 'chat.search')}
      onclick={(event) => search(event.currentTarget)}><Glyph name="search" /></button
    >
  {/if}
  {#if managing.length}
    <button
      type="button"
      class="orden-glyph"
      aria-label={t('More')}
      use:tip={() => t('More')}
      onclick={(event) => menu.show(event, managing)}><Glyph name="more" /></button
    >
  {/if}
</header>

<Float
  at={showing?.at ?? null}
  end
  width="280px"
  label={showing?.what === 'pins' ? t('Pinned') : t('Search this chat')}
  onclose={() => (showing = null)}
>
  <div class="list orden-scrolls">
    {#if showing?.what === 'found'}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="orden-field look"
        type="search"
        aria-label={t('Search this chat')}
        placeholder={t('Search')}
        autofocus
        bind:value={looking}
        oninput={() => void lookFor(looking)}
      />
      {#each found as one (one.message.id)}
        <button
          type="button"
          class="pin"
          onclick={() => {
            showing = null
            void page.jump(one.message.id)
          }}
        >
          <strong>{nameOf(one.message.author, page.members, space)}</strong>
          <span>{firstLine(one.message.body) || '…'}</span>
        </button>
      {/each}
    {:else if showing?.what === 'pins'}
      {#each pinned as one (one.id)}
        <button
          type="button"
          class="pin"
          onclick={() => {
            showing = null
            void page.jump(one.id)
          }}
        >
          <strong>{nameOf(one.author, page.members, space)}</strong>
          <span>{firstLine(one.body) || '…'}</span>
        </button>
      {:else}
        <p class="none"><Glyph name="pin" /></p>
      {/each}
    {/if}
  </div>
</Float>

<style>
  .head {
    --glyph-size: 16px;
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 44px;
    padding: 0 var(--space-2) 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
  }

  .mark {
    color: var(--muted);
  }

  .service {
    width: 16px;
    height: 16px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .look {
    margin: var(--space-1);
  }

  .name {
    margin: 0;
    color: var(--text-strong);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    white-space: nowrap;
  }

  .topic,
  .topic-field {
    min-width: 0;
    max-width: 50%;
    flex: 0 1 auto;
    padding: 2px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .topic-field {
    flex: 1;
    max-width: none;
    border-color: var(--accent-line);
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  @media (hover: hover) {
    .topic:hover:not(:disabled) {
      border-color: var(--line);
    }
  }

  .topic.empty {
    opacity: 0.6;
  }

  .grow {
    flex: 1;
  }

  .people {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--row-height);
    padding: 0 var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .people:hover {
      background: var(--surface-hover);
    }
  }

  .people.on {
    background: var(--surface-selected);
    color: var(--text);
  }

  .faces {
    display: inline-flex;
  }

  .face {
    display: inline-flex;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--bg);
  }

  .face + .face {
    margin-inline-start: -6px;
  }

  .list {
    overflow-y: auto;
    padding: var(--space-1);
  }

  .pin {
    display: flex;
    flex-direction: column;
    gap: 2px;
    width: 100%;
    padding: var(--space-2);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
  }

  @media (hover: hover) {
    .pin:hover {
      background: var(--surface-hover);
    }
  }

  .pin span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--muted-strong);
  }

  .none {
    --glyph-size: 20px;
    display: grid;
    place-items: center;
    margin: var(--space-4) 0;
    color: var(--muted);
    opacity: 0.5;
  }
</style>

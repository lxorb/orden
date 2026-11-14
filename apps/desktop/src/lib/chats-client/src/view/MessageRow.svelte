<script lang="ts">
  import type { Message, Who } from '@orden/chats'
  import { chatLinkOf } from '@orden/chats/links'
  import type { Shown } from '../shapes'
  import { cubicOut } from 'svelte/easing'
  import { downloadStarted } from '../../../downloads/src/api'
  import { localNumber } from '../../../platform/src/api'
  import { dur, fly } from '../../../platform/src/api'
  import { followHref } from '../../../open-link'
  import { Avatar } from '../../../accounts-ui/src/api'
  import { showProfile } from '../../../accounts-ui/src/api'
  import { links } from '../../../link-index.svelte'
  import { workspace } from '../../../workspace.svelte'
  import { bodyHtml, firstLine, onlyEmoji } from './body'
  import { drawing } from '../../../markdown-view.svelte'
  import type { ChatPage } from './chat.svelte'
  import Gallery from './Gallery.svelte'
  import { Glyph } from '../../../chat-kit/src/api'
  import { markMentions } from './marks'
  import NoteCard from './NoteCard.svelte'
  import { cardTarget } from './note-card'
  import { sortFiles } from './media'
  import { accountOf, faceOf, nameOf } from './people'
  import PollCard from './PollCard.svelte'
  import Reactions from './Reactions.svelte'
  import { readableSize } from '../../../usage.svelte'
  import { fileUrl } from './urls.svelte'
  import { tip } from './tips.svelte'
  import Voice from './Voice.svelte'
  import { fullTime, timeOf } from './when'

  const {
    message,
    head,
    pending,
    seen,
    page,
    space,
    column,
    lit,
    flashed,
    arrivedAfter,
    canPost,
    inReplies = false,
    onreply,
    onreact,
    onmenu,
    onfiles,
  }: {
    message: Shown
    head: boolean
    pending: boolean
    seen: Who[]
    page: ChatPage
    space: string | null
    column: number
    lit: boolean
    flashed: boolean
    arrivedAfter: number
    canPost: boolean
    inReplies?: boolean
    onreply: (message: Message) => void
    onreact: (message: Message, from: HTMLElement) => void
    onmenu: (event: MouseEvent, message: Message) => void
    onfiles: (message: Message, index: number) => void
  } = $props()

  const name = $derived(nameOf(message.author, page.members, space))
  const files = $derived(sortFiles(message.files))
  const quoted = $derived(
    message.quote === undefined ? null : page.messages.find((one) => one.id === message.quote),
  )
  const mine = $derived(page.me !== null && message.author === page.me)
  const arrived = $derived(message.seq > arrivedAfter)
  const callable = $derived(
    page.members.flatMap((one) =>
      [one.nick, one.name]
        .filter((label): label is string => !!label)
        .map((label) => ({ label, me: one.who === page.me })),
    ),
  )
  const big = $derived(!message.files.length && onlyEmoji(message.body))
  const linked = $derived(message.deleted ? null : cardTarget(message.body))

  const home = $derived(page.entry?.path ?? null)

  function words(
    node: HTMLElement,
    said: {
      body: string
      edited: boolean
      from: string | null
      version: number
      drawn: number
    },
  ) {
    let untip: { destroy: () => void } | null = null
    const draw = (next: { body: string; edited: boolean; from: string | null }) => {
      untip?.destroy()
      untip = null
      node.innerHTML = bodyHtml(next.body, next.from)
      markMentions(node, callable)
      if (!next.edited) return
      const mark = document.createElement('span')
      mark.className = 'edited'
      mark.textContent = 'Edited'
      const last = node.lastElementChild
      if (last?.tagName === 'P') last.append(' ', mark)
      else node.append(mark)
      untip = tip(mark, () => history)
    }
    draw(said)
    return { update: draw, destroy: () => untip?.destroy() }
  }

  function follow(event: MouseEvent) {
    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return
    event.preventDefault()
    const link = chatLinkOf(href)
    if (link?.chat === page.id && link.message) {
      void page.jump(link.message)
      return
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) followHref(href, event)
    else workspace.openRelative(decodeURIComponent(href.split('#')[0] ?? href), {}, home)
  }

  function profile(event: MouseEvent) {
    const id = accountOf(message.author)
    if (id && event.currentTarget instanceof Element) showProfile(id, event.currentTarget, space)
  }

  const history = $derived(
    message.history.map((one) => `${timeOf(one.at)}  ${one.body}`).join('\n'),
  )
</script>

{#snippet agent()}
  <span class="agent" aria-hidden="true">✦</span>
{/snippet}

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="message"
  class:head
  class:lit
  class:flash={flashed}
  class:pending
  data-message={message.id}
  oncontextmenu={(event) => onmenu(event, message)}
  in:fly={{
    y: arrived && !mine ? 6 : 0,
    duration: dur(arrived && !mine ? 160 : 0),
    easing: cubicOut,
  }}
>
  <div class="gutter">
    {#if head}
      <Avatar
        face={faceOf(message.author, page.members, space)}
        size={32}
        onpress={accountOf(message.author) ? profile : undefined}
        label={name}
        {...message.via ? { mark: agent } : {}}
      />
    {:else}
      <time class="hover-time" use:tip={() => fullTime(message.at)}>{timeOf(message.at)}</time>
    {/if}
  </div>

  <div class="main">
    {#if head}
      <div class="meta">
        <button type="button" class="name" onclick={profile}>{name}</button>
        {#if message.via}
          <span class="via" use:tip={() => message.via?.agent ?? ''}>✦</span>
        {/if}
        <time use:tip={() => fullTime(message.at)}>{timeOf(message.at)}</time>
        {#if message.pinned}<span class="pinned" aria-label="Pinned"><Glyph name="pin" /></span
          >{/if}
      </div>
    {:else if message.pinned}
      <span class="pinned corner" aria-label="Pinned"><Glyph name="pin" /></span>
    {/if}

    {#if message.quote !== undefined}
      <button
        type="button"
        class="quoted"
        onclick={() => message.quote && void page.jump(message.quote)}
      >
        <Glyph name="quote" />
        {#if quoted}
          <strong>{nameOf(quoted.author, page.members, space)}</strong>
          <span
            >{quoted.deleted
              ? 'Deleted'
              : firstLine(quoted.body) || (quoted.files[0]?.name ?? '')}</span
          >
        {:else}
          <span>…</span>
        {/if}
      </button>
    {/if}

    {#if message.deleted}
      <p class="deleted">Deleted</p>
    {:else}
      {#if message.body}
        <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
        <div
          class="body orden-rendered"
          class:big
          dir="auto"
          use:words={{
            body: message.body,
            edited: message.editedAt !== undefined,
            from: home,
            version: links.version,
            drawn: drawing.version,
          }}
          onclick={follow}
        ></div>
      {/if}

      {#if linked}
        <NoteCard target={linked} from={home} />
      {/if}

      {#if files.seen.length}
        <Gallery
          chat={page.id}
          files={files.seen}
          {column}
          onopen={(index: number) => onfiles(message, index)}
        />
      {/if}
      {#each files.heard as file (file.hash)}
        <Voice chat={page.id} {file} />
      {/each}
      {#each files.other as file (file.hash)}
        <a
          class="file"
          href={fileUrl(page.id, file.hash)}
          download={file.name}
          onclick={(event) => downloadStarted(file.name, { element: event.currentTarget })}
          use:tip={() => file.name}
        >
          <Glyph name="file" />
          <span class="file-name">{file.name}</span>
          <span class="file-size">{readableSize(file.size)}</span>
        </a>
      {/each}

      {#if message.preview}
        <a
          class="preview"
          href={message.preview.url}
          onclick={(event) => {
            event.preventDefault()
            if (message.preview) followHref(message.preview.url, event)
          }}
        >
          <span class="preview-words">
            {#if message.preview.site}<span class="site">{message.preview.site}</span>{/if}
            <strong>{message.preview.title}</strong>
            {#if message.preview.text}<span class="text">{message.preview.text}</span>{/if}
          </span>
          {#if message.preview.picture}
            <img
              src={fileUrl(page.id, message.preview.picture)}
              alt=""
              draggable="false"
              loading="lazy"
            />
          {/if}
        </a>
      {/if}

      {#if message.poll}
        <PollCard {message} {page} {space} canVote={canPost} />
      {/if}

      <Reactions
        {message}
        {page}
        {space}
        canReact={canPost && !pending}
        onmore={(from: HTMLElement) => onreact(message, from)}
      />
    {/if}

    {#if message.replies > 0 && !inReplies}
      <button type="button" class="replies" onclick={() => onreply(message)}>
        <Glyph name="replies" />
        <span class="count">{localNumber(message.replies)}</span>
        {#if message.lastReplyAt}<span class="last">{timeOf(message.lastReplyAt)}</span>{/if}
      </button>
    {/if}

    {#if pending}
      <span class="sending" aria-label="Sending"><Glyph name="clock" /></span>
    {/if}
    {#if message.refused}
      <span class="refused">
        <button type="button" class="orden-chip" onclick={() => page.retry(message.id)}
          >Try again</button
        >
        <button type="button" class="orden-chip is-quiet" onclick={() => page.discard(message.id)}
          >Delete</button
        >
      </span>
    {/if}

    {#if seen.length}
      <span class="seen">
        {#each seen as who (who)}
          <span use:tip={() => nameOf(who, page.members, space)}>
            <Avatar face={faceOf(who, page.members, space)} size={16} />
          </span>
        {/each}
      </span>
    {/if}
  </div>
</div>

<style>
  .message {
    position: relative;
    display: grid;
    grid-template-columns: 44px minmax(0, 1fr);
    gap: 0 var(--space-2);
    padding: 2px var(--space-4) 2px var(--space-2);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    line-height: 1.45;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .message.head {
    padding-top: var(--space-3);
  }

  @media (hover: hover) {
    .message:hover {
      background: var(--surface-hover);
    }
  }

  .message.lit {
    background: var(--surface-selected);
  }

  .message.flash {
    animation: landed 1.2s var(--ease-out);
  }

  @keyframes landed {
    from {
      background: var(--accent-soft);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .message.flash {
      animation: none;
      background: var(--accent-soft);
    }
  }

  .message.pending .body {
    opacity: 0.6;
  }

  .gutter {
    display: flex;
    justify-content: center;
    padding-top: 2px;
  }

  .hover-time {
    visibility: hidden;
    color: var(--muted);
    font-size: 10.5px;
    line-height: 22px;
    font-variant-numeric: tabular-nums;
  }

  .message:hover .hover-time,
  .message.lit .hover-time {
    visibility: visible;
  }

  .meta {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .name {
    padding: 0;
    border: none;
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-weight: var(--weight-strong);
    cursor: pointer;
  }

  @media (hover: hover) {
    .name:hover {
      text-decoration: underline;
    }
  }

  .meta time,
  .via {
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .via {
    color: var(--accent);
  }

  .pinned {
    --glyph-size: 12px;
    align-self: center;
    color: var(--accent);
  }

  .pinned.corner {
    position: absolute;
    top: 6px;
    right: var(--space-4);
  }

  .agent {
    display: grid;
    place-items: center;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: 8px;
  }

  .quoted {
    --glyph-size: 12px;
    display: flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 100%;
    margin: 2px 0;
    padding: 0 0 0 var(--space-2);
    border: none;
    border-inline-start: 2px solid var(--line-strong);
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-sm);
    text-align: start;
    cursor: pointer;
  }

  .quoted span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quoted strong {
    flex: none;
    color: var(--muted-strong);
    font-weight: var(--weight-strong);
  }

  .body {
    overflow-wrap: anywhere;
  }

  .body :global(:is(p, ul, ol, pre, blockquote, table, h1, h2, h3, h4, h5, h6)) {
    margin: 0;
  }

  .body :global(:is(p, ul, ol, pre, blockquote, table) + *) {
    margin-top: var(--space-2);
  }

  .body :global(:is(h1, h2, h3)) {
    font-size: var(--text-head);
  }

  .body :global(pre) {
    direction: ltr;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--code-block-bg-color, var(--surface-2));
    overflow-x: auto;
    font-size: var(--text-sm);
  }

  .body :global(.mention) {
    padding: 0 2px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  .body :global(.mention.is-me) {
    background: var(--accent);
    color: var(--accent-ink);
  }

  .body.big {
    font-size: 2.4em;
    line-height: 1.2;
  }

  .body :global(.edited),
  .deleted {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .deleted {
    margin: 0;
    font-style: italic;
  }

  .file {
    --glyph-size: 18px;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: min(320px, 100%);
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
    color: var(--text);
    text-decoration: none;
  }

  .file-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file-size {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .preview {
    display: flex;
    gap: var(--space-3);
    width: min(440px, 100%);
    margin-top: var(--space-1);
    padding: var(--space-2) var(--space-3);
    border-inline-start: 3px solid var(--accent-line);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    color: var(--text);
    text-decoration: none;
  }

  .preview-words {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .preview .site {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .preview strong {
    color: var(--accent);
    font-weight: var(--weight-strong);
  }

  .preview .text {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    color: var(--muted-strong);
    font-size: var(--text-sm);
  }

  .preview img {
    flex: none;
    width: 72px;
    height: 72px;
    border-radius: var(--radius-sm);
    object-fit: cover;
  }

  .replies {
    --glyph-size: 14px;
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    margin-top: var(--space-1);
    padding: 2px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    cursor: pointer;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .replies:hover {
      border-color: var(--line);
      background: var(--surface);
    }
  }

  .replies .last {
    color: var(--muted);
    font-weight: var(--weight-row);
    font-size: var(--text-xs);
  }

  .sending {
    --glyph-size: 11px;
    position: absolute;
    right: var(--space-3);
    bottom: 6px;
    color: var(--muted);
    opacity: 0.7;
  }

  .refused {
    display: inline-flex;
    gap: var(--space-1);
    margin-top: var(--space-1);
  }

  .seen {
    display: flex;
    justify-content: flex-end;
    gap: 2px;
    margin-top: 2px;
  }
</style>

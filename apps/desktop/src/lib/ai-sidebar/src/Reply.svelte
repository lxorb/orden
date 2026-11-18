<script lang="ts">
  import { untrack } from 'svelte'
  import { SvelteSet } from 'svelte/reactivity'
  import type { EditorView } from '@orden/editor'
  import { dollarMaths } from '@orden/markdown/streamed'
  import { cubicOut } from 'svelte/easing'
  import Answer from './Answer.svelte'
  import LiveAnswer from './LiveAnswer.svelte'
  import { answerHtml } from './drawn'
  import { citationLinks, citedIn, linkedAnswer, chat, lasted } from './chat-parts'
  import type { Part, Turn } from '../../ai-providers/src/api'
  import { Copied, when } from '../../ui-controls/src/api'
  import { region, dur, fly, slide, insideSpace, withinSpace } from '../../platform/src/api'
  import { links } from '../../link-index/src/api'
  import { DIVIDER, menu, type MenuEntry, viewport } from '../../ui-kit/src/api'
  import { followHref, followNote, MIDDLE, opensLink, workspace } from '../../workspace/src/api'
  import { howFor, tabAsk } from '../../workspace/src/api'
  import { views } from '../../panes/src/api'
  import { ai } from '../../ai-providers/src/api'
  import type { Source } from './chat-parts'
  import Explored from './Explored.svelte'
  import PartRow from './PartRow.svelte'
  import Spawned from './Spawned.svelte'
  import StepLine from './StepLine.svelte'
  import { type Block, blocksOf, foldOf } from './steps'
  import TaskRows from './TaskRows.svelte'

  interface Props {
    turn: Turn
    sources: Source[]
    last: boolean
    live: boolean
    ongoto?: ((line: number) => void) | undefined
  }
  const { turn, sources, last, live, ongoto }: Props = $props()

  const words = $derived(
    turn.parts.flatMap((part) => (part.kind === 'text' ? [part.text] : [])).join(''),
  )

  type Notice = Extract<Part, { kind: 'notice' }>

  const blocks = $derived(blocksOf(turn.parts))
  const fold = $derived(foldOf(blocks, live))
  let working = $state(false)
  const showWork = $derived(working || chat.unfolded)
  const worked = $derived(turn.took ? `Worked for ${lasted(turn.took, region())}` : 'Worked')
  const pictures = new SvelteSet<string>()
  const show = (src: string) => pictures.add(src)

  function drawn(text: string, still: boolean): string {
    const source = citationLinks(text, sources.length)
    const from = untrack(() => workspace.panelTab?.path ?? null)
    return answerHtml(source, {
      resolveLink: (link) => {
        const found = link.target
          ? links.targetOf(from, { kind: 'wikilink', target: link.target })
          : null
        return found === null ? null : { href: found }
      },
      copy: 'Copy code',
      live: still,
      from,
      shown: pictures,
    })
  }

  const cited = $derived.by(() => {
    const out: Source[] = []
    for (const n of citedIn(words, sources.length)) {
      const one = sources[n - 1]
      if (one && !out.some((other) => other.path === one.path)) out.push(one)
    }
    return out
  })

  async function openAt(source: Source, press: MouseEvent) {
    const root = chat.root
    if (!root) return
    const ask = tabAsk(press)
    if (viewport.drawer) workspace.closePanel('right')
    await workspace.open(insideSpace(root, source.path), howFor(ask))
    if (ask !== 'behind') ongoto?.(source.line)
  }

  function follow(event: MouseEvent) {
    if (!opensLink(event)) return
    const anchor = (event.target as Element | null)?.closest('a')
    const href = anchor?.getAttribute('href')
    if (!anchor || !href) return
    event.preventDefault()
    const number = /^#cite-(\d+)$/.exec(href)
    if (number) {
      const source = sources[Number(number[1]) - 1]
      if (source) void openAt(source, event)
      return
    }
    if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith('//')) {
      followHref(href, event)
      return
    }
    if (event.button === MIDDLE && !anchor.classList.contains('wikilink')) return
    followNote(
      { path: href, target: href, heading: null, block: null, page: null },
      event,
      workspace.panelTab?.path ?? null,
    )
  }

  const spelled = $derived(dollarMaths(words))
  const asNote = $derived(linkedAnswer(spelled, sources))
  const view = $derived<EditorView | undefined>(views.of(workspace.panes.focusedId))

  function inserted(): string {
    const root = chat.root
    const into = workspace.active?.path ?? null
    const here = root !== null && into !== null && withinSpace(root, into) !== null
    return here ? asNote : linkedAnswer(spelled, sources, (one) => one.name)
  }

  function insert() {
    const editor = view
    if (!editor || editor.state.readOnly) return
    const text = inserted()
    const { from, to } = editor.state.selection.main
    editor.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: 'input.paste',
    })
    editor.focus()
  }

  const saveAsNote = () => chat.noteFrom(asNote)
  const copied = new Copied()
  const DONE = 'M2.8 6.8l2.4 2.4 5-5.4'
  const COPY =
    'M4.5 4.5V3a1 1 0 0 1 1-1H10a1 1 0 0 1 1 1v4.5a1 1 0 0 1-1 1H8.5M3 4.5h4.5a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5.5a1 1 0 0 1 1-1z'
  const INSERT = 'M6.5 2v6.5M3.8 5.8l2.7 2.7 2.7-2.7M2.5 11h8'

  function againMenu(event: MouseEvent) {
    const provider = chat.provider
    if (!provider) return
    const listed = chat.models[provider.id] ?? []
    const rows: MenuEntry[] = listed.map((one) => ({
      label: one.name,
      checked: one.id === chat.head?.model,
      run: () => chat.retry({ provider: provider.id, id: one.id }),
    }))
    menu.show(event, [{ label: 'Ask again', run: () => chat.retry() }, DIVIDER, ...rows], {
      title: 'Ask again',
    })
  }

  function moreMenu(event: MouseEvent) {
    menu.show(event, [
      ...(answered ? [{ label: 'Save as a note', run: () => void saveAsNote() }] : []),
      { label: 'Branch', run: () => chat.branch(undefined, turn.id) },
    ])
  }

  const NOTICE_WORDS: Partial<Record<Notice['code'], string>> = {
    compacted: 'Compacted',
    steps: 'Step limit',
    max_tokens: 'Length limit',
    stopped: 'Stopped',
    no_tools: 'Without tools',
    tasks: '',
  }

  function noticeOf({ code, text }: Notice): string {
    if (code === 'refusal') return text ? `Declined: ${text}` : 'Declined'
    return NOTICE_WORDS[code] ?? text
  }

  const failed = $derived(
    turn.parts.some((part) => part.kind === 'notice' && part.code === 'error'),
  )
  const answered = $derived(!!words.trim())
  const reset = $derived(chat.head ? chat.resets[chat.head.id] : undefined)
</script>

{#snippet one(block: Block)}
  {#if block.kind === 'words'}
    {@const still = live && block.at === blocks.at(-1)?.at}
    {#if still}
      <LiveAnswer
        text={block.text}
        draw={(text: string) => drawn(text, true)}
        onfollow={follow}
        onpicture={show}
      />
    {:else}
      <Answer html={drawn(block.text, false)} onfollow={follow} onpicture={show} />
    {/if}
  {:else if block.kind === 'notice' && block.notice.code === 'tasks'}
    <TaskRows said={block.notice.text} />
  {:else if block.kind === 'notice'}
    <p
      class="notice"
      class:wrong={block.notice.code === 'error'}
      class:model={block.notice.code === 'model'}
      class:said={block.notice.code === 'command'}
      in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}
    >
      {noticeOf(block.notice)}
      {#if block.notice.code === 'error' && last && !live}
        <button class="link" onclick={() => chat.retry()}>Ask again</button>
        {#if reset?.waiting}
          Continues at {when(reset.until, 'medium')}
          <button class="link" onclick={() => chat.waitForReset(false)}>Cancel</button>
        {:else if reset}
          <button class="link" onclick={() => chat.waitForReset(true)}>
            Continue when the limit resets
          </button>
        {/if}
      {/if}
    </p>
    {#if block.notice.threads?.length}
      <Spawned threads={block.notice.threads} />
    {/if}
  {:else if block.kind === 'explored'}
    <div in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <Explored rows={block.rows} {live} />
    </div>
  {:else}
    <div in:fly={{ y: 8, duration: dur(150), easing: cubicOut }}>
      <PartRow part={block.row} {live} />
    </div>
  {/if}
{/snippet}

{#snippet act(
  label: string,
  run: (event: MouseEvent) => void,
  path: string,
  menu = false,
  disabled = false,
)}
  <button
    class="orden-glyph act"
    title={label}
    aria-label={label}
    aria-haspopup={menu ? 'menu' : undefined}
    {disabled}
    onclick={run}
  >
    <svg class:dots={label === 'More'} viewBox="0 0 13 13"><path d={path} /></svg>
  </button>
{/snippet}

<div class="answer" class:last>
  {#each fold.before as block (block.at)}
    {@render one(block)}
  {/each}
  {#if fold.work.length}
    <div class="worked">
      <StepLine verb={worked} open={showWork} onpress={() => (working = !working)} />
    </div>
    {#if showWork}
      <div class="work" transition:slide={{ duration: dur(150), easing: cubicOut }}>
        {#each fold.work as block (block.at)}
          {@render one(block)}
        {/each}
      </div>
    {/if}
  {/if}
  {#each fold.after as block (block.at)}
    {@render one(block)}
  {/each}
  {#if cited.length}
    <div class="sources">
      {#each cited as one (one.path)}
        <button class="source" title={one.path} onclick={(event) => void openAt(one, event)}
          >{one.name}</button
        >
      {/each}
    </div>
  {/if}
  {#if !live && (answered || (last && !failed))}
    <div class="acts">
      {#if answered}
        {@render act('Copy', () => void copied.copy(asNote, true), copied.what ? DONE : COPY)}
        {@render act('Insert at the caret', insert, INSERT, false, !view || view.state.readOnly)}
      {/if}
      {#if last && ai.providers.length && !chat.answeredElsewhere}
        {@render act('Ask again', againMenu, 'M10.6 6.5a4.1 4.1 0 1 1-1.2-2.9M10.6 2v2.6H8', true)}
      {/if}
      {@render act('More', moreMenu, 'M3 6.5h.01M6.5 6.5h.01M10 6.5h.01', true)}
    </div>
  {/if}
</div>

<style>
  .answer {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .worked {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .worked::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .work {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .notice {
    margin: 0;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .notice.model {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .notice.model::before,
  .notice.model::after {
    content: '';
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .notice.said {
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .notice.wrong {
    color: var(--danger);
  }

  .sources,
  .acts {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .source {
    max-width: 100%;
    padding: 1px var(--space-2);
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--ink-wash);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: default;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .source:hover {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .acts {
    gap: 0;
    margin-inline-start: -6px;
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .answer:hover .acts,
  .acts:focus-within,
  :global([data-touch]) .acts {
    opacity: 1;
  }

  .act {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .act .dots {
    stroke-width: 2.2;
  }

  .act svg {
    stroke-width: 1.3;
  }

  .link {
    padding: 0;
    margin-inline-start: var(--space-1);
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    cursor: default;
  }

  @media (hover: hover) {
    .link:hover {
      text-decoration: underline;
    }
  }
</style>

<script lang="ts">
  import Facts from '../../Facts.svelte'
  import { cubicOut } from 'svelte/easing'
  import { region } from '../../region'
  import Cross from '../../Cross.svelte'
  import { chooseFiles } from '../../choose-files'
  import { links } from '../../link-index.svelte'
  import { longPaste } from '../../long-paste'
  import { DIVIDER, menu } from '../../menu.svelte'
  import { dur, fly } from '../../platform/src/api'
  import { overlays } from '../../overlays'
  import { shortcuts } from '../../shortcuts.svelte'
  import { samePath, withinSpace } from '../../platform/src/api'
  import { views } from '../../views.svelte'
  import { workspace, type Entry } from '../../workspace.svelte'
  import { estimateText } from '../chat/usage'
  import DictateButton from '../../dictation/DictateButton.svelte'
  import { canDictate } from '../../dictation/engines.svelte'
  import { dictating } from '../../dictation/keys'
  import type { Dictates } from '../../dictation/voice.svelte'
  import { noteInFront, SELECTION_CHIP, selectionHere } from './around'
  import { chat } from './chat.svelte'
  import { dictation } from './dictate.svelte'
  import type { Front } from './gather'
  import { hostHere } from './host'
  import MentionMark from './MentionMark.svelte'
  import ModeMark from './ModeMark.svelte'
  import { type Mention, mentionAt, mentionOf, ranked, type Row, sameMention } from './mentions'
  import ModelPicker from './ModelPicker.svelte'
  import { chatPicture, MOST_CHAT_PICTURES, MOST_CHAT_TEXT, textHeld } from './picture'
  import { minutes, tokens } from './numbers'
  import Queue from './Queue.svelte'
  import Ring from './Ring.svelte'
  import type { PanelCommand } from '../commands/types'
  import Rewinding from '../review/Rewinding.svelte'
  import { commandIn, commandsFor, matching, rowNamed } from './seams'
  import Suggest from './Suggest.svelte'
  import { grow } from '../../grow'
  import { MODES, FIRST_MODE, type Mode, modeWord } from '../modes'

  let field = $state<HTMLTextAreaElement>()
  let caret = $state(0)
  let lit = $state(0)
  let hushed = $state('')
  let commands = $state<readonly PanelCommand[]>([])
  const here = hostHere()

  const voiceField: Dictates = {
    field: () => field,
    words: () => [
      ...(head?.title ? [head.title] : []),
      ...(front ? [front.name] : []),
      ...chat.chips.map((one) => one.label),
    ],
    trouble: (said) => (chat.trouble = said),
  }

  const head = $derived(chat.head)
  const busy = $derived(chat.busy)
  const root = $derived(chat.root)
  const home = $derived(root !== null && samePath(root, workspace.activeSpace?.root))

  const front = $derived.by((): (Front & { key: string }) | null => {
    const note = noteInFront(root)
    return note ? { ...note, key: `note:${note.path}` } : null
  })

  const selection = $derived(views.chosen > 0 ? views.selectedText() : '')
  const selectionKey = $derived(`selection:${selection.slice(0, 60)}`)
  const frontOn = $derived(!!front && !chat.dropped.includes(front.key))
  const selectionOn = $derived(!!selection.trim() && !chat.dropped.includes(selectionKey))

  function around() {
    const on = front && !chat.dropped.includes(front.key) ? front : null
    const picked = selectionHere()
    const pickedOn =
      !!picked.text && !chat.dropped.includes(`selection:${picked.text.slice(0, 60)}`)
    return {
      front: on ? { path: on.path, name: on.name, text: on.text } : null,
      selection: pickedOn ? picked.text : '',
      picked: pickedOn ? picked.picked : null,
    }
  }
  chat.around = around

  const FRONT_MOST = 12_000

  function sentChips(): Mention[] {
    const chips = chat.chips.filter((one) => one.kind !== 'picture' || chat.model?.images !== false)
    return selectionOn && !chips.some((one) => one.kind === 'selection')
      ? [...chips, SELECTION_CHIP]
      : chips
  }

  const attached = $derived.by(() => {
    let sum = 0
    if (frontOn && front && head?.mode !== 'approve')
      sum += Math.min(FRONT_MOST, estimateText(front.text.slice(0, FRONT_MOST * 4)))
    if (selectionOn) sum += estimateText(selection)
    for (const chip of chat.chips) {
      if (chip.text) sum += estimateText(chip.text)
      if (chip.image) sum += 1_600
    }
    return sum
  })

  const next = $derived(estimateText(chat.text) + attached)

  const mention = $derived(mentionAt(chat.text, caret))
  const slash = $derived(/^\/[\w-]*$/.test(chat.text) ? chat.text.slice(1) : null)

  function folders(): Entry[] {
    const out: Entry[] = []
    const walk = (entry: Entry) => {
      for (const child of entry.children) {
        if (!child.is_dir) continue
        out.push(child)
        walk(child)
      }
    }
    if (workspace.tree) walk(workspace.tree)
    return out
  }

  function candidates(): Mention[] {
    const out: Mention[] = []
    if (views.chosen > 0)
      out.push({ kind: 'selection', id: 'selection', label: 'Selection', word: 'selection' })
    for (const tab of workspace.tabs) {
      if (tab.kind === 'web') out.push({ kind: 'tab', id: tab.id, label: tab.shown, word: 'tab' })
    }
    out.push({ kind: 'web', id: 'web', label: 'Web search', word: 'web' })
    out.push({ kind: 'scratchpad', id: 'scratchpad', label: 'Scratchpad', word: 'scratchpad' })
    if (home) {
      for (const note of workspace.notes) out.push(mentionOf(note))
      for (const folder of folders()) out.push(mentionOf(folder))
      for (const { tag } of links.spaceTags) out.push({ kind: 'tag', id: tag, label: `#${tag}` })
    }
    for (const one of chat.heads) {
      if (one.id !== head?.id && one.title)
        out.push({ kind: 'thread', id: one.id, label: one.title, space: one.space })
    }
    return out
  }

  const found = $derived(mention && hushed !== chat.text ? ranked(candidates(), mention.query) : [])

  const slashing = $derived(slash !== null)

  $effect(() => {
    if (slashing) void commandsFor(chat).then((rows) => (commands = rows))
  })

  const commandRows = $derived(
    slash !== null && hushed !== chat.text ? matching(commands, slash) : [],
  )

  const rows = $derived.by((): Row[] => {
    if (commandRows.length) {
      const kind = chat.provider?.kind
      return commandRows.map((one) => {
        const why = kind ? one.available(kind) : true
        return {
          key: one.name,
          label: `/${one.name}`,
          hint:
            one.description ??
            [one.args, ...one.synonyms.map((word) => `/${word}`)].filter(Boolean).join('  '),
          ...(why === true ? {} : { dim: why }),
        }
      })
    }
    return found.map((one) => ({
      key: `${one.kind}:${one.id}`,
      label: one.label,
      mark: one.kind,
      ...(one.kind === 'note' ? { hint: folderIn(one.id) } : {}),
    }))
  })

  const follows = (..._values: unknown[]) => undefined

  $effect(() => {
    follows(rows)
    lit = 0
  })

  function folderIn(path: string): string {
    const inside = root ? withinSpace(root, path) : null
    const at = inside?.lastIndexOf('/') ?? -1
    return inside && at > 0 ? inside.slice(0, at) : ''
  }

  let foot = $state<HTMLElement>()

  $effect(() =>
    chat.popover
      ? overlays.show(
          () => (chat.popover = null),
          () => [...(foot?.querySelectorAll('.pop, .tray, .picker .chip, .knob') ?? [])],
        )
      : undefined,
  )

  function footKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !chat.popover) return
    event.preventDefault()
    event.stopPropagation()
    chat.popover = null
    chat.focus()
  }

  function addChip(chip: Mention) {
    if (!chat.chips.some((one) => sameMention(one, chip))) chat.chips = [...chat.chips, chip]
  }

  function pick(index: number, complete = false) {
    const command = commandRows[index]
    if (command) {
      const offered = command.available(chat.provider?.kind ?? 'compatible') === true
      if (complete || !offered || command.args?.startsWith('<')) {
        chat.text = `/${command.name} `
        place(chat.text.length)
        return
      }
      chat.taken()
      void command.run({ args: '', thread: chat.thread, panel: chat })
      return
    }
    const chosen = found[index]
    const at = mention
    if (!chosen || !at) return
    addChip(chosen)
    const before = chat.text.slice(0, at.from)
    const after = chat.text.slice(caret)
    const joined = before.endsWith(' ') && after.startsWith(' ') ? before.slice(0, -1) : before
    chat.text = joined + after
    place(joined.length)
  }

  function place(at: number) {
    requestAnimationFrame(() => {
      field?.focus()
      field?.setSelectionRange(at, at)
      caret = at
    })
  }

  async function runTyped(): Promise<boolean> {
    const typed = commandIn(chat.text)
    if (!typed) return false
    if (!commands.length) commands = await commandsFor(chat)
    const named = rowNamed(commands, typed.name)
    if (named?.row.available(chat.provider?.kind ?? 'compatible') !== true) return false
    chat.taken()
    void named.row.run({
      args: typed.args,
      thread: chat.thread,
      panel: chat,
      ...(named.typed ? { typed: named.typed } : {}),
    })
    return true
  }

  async function submit() {
    if (await runTyped()) return
    chat.chips = sentChips()
    chat.submit(around())
  }

  function onKey(event: KeyboardEvent) {
    if (event.isComposing) return
    if (rows.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        lit = (lit + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length
        return
      }
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
        event.preventDefault()
        pick(lit, event.key === 'Tab')
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        hushed = chat.text
        return
      }
    }
    const run = (action: () => void) => {
      event.preventDefault()
      event.stopPropagation()
      action()
    }
    if (shortcuts.pressed('ai.mode', event)) return run(() => chat.nextMode())
    if (shortcuts.pressed('ai.model', event))
      return run(() => (chat.popover = chat.popover === 'model' ? null : 'model'))
    if (shortcuts.pressed('ai.effort', event)) return run(() => chat.setEffort('next'))
    if (shortcuts.pressed('ai.steer', event))
      return run(() => (busy ? chat.steer() : void submit()))
    if (shortcuts.pressed('ai.unfold', event)) return run(() => chat.toggleFolded())
    if (shortcuts.pressed('ai.new', event)) return run(() => chat.newThread())
    if (shortcuts.pressed('ai.stop', event) && (busy || chat.popover)) {
      return run(() => {
        if (chat.popover) chat.popover = null
        else chat.stop()
      })
    }
    if (event.key === 'Enter' && !event.shiftKey) return run(() => void submit())
    const empty = !chat.text.trim()
    if (event.key === 'ArrowUp' && empty && !event.altKey && !event.ctrlKey && !event.metaKey)
      return run(() => chat.startEdit())
    if (event.key === 'Escape' && chat.changing) return run(() => chat.cancelEdit())
    if (event.key === 'Escape' && empty && head?.kept) {
      const now = Date.now()
      if (now - escaped < 500) {
        escaped = 0
        return run(() => chat.rewind())
      }
      escaped = now
      return run(() => undefined)
    }
  }

  function onInput() {
    caret = field?.selectionStart ?? 0
  }

  let drawing = 0
  let reading = 0

  function textRoom(): number {
    return MOST_CHAT_TEXT - textHeld(chat.chips) - reading
  }

  function tooMuchText(name: string) {
    chat.trouble = `${name} was not added: a message takes up to 4 MB of text in all.`
  }

  function take(file: File) {
    const name = file.name || 'Picture'
    const refused = () => {
      chat.trouble = `${name} was not added: a chat takes pictures, and text files up to 2 MB.`
    }
    const unread = () => {
      chat.trouble = `${name} could not be read.`
    }
    if (file.type.startsWith('image/')) {
      const held = chat.chips.filter((one) => one.kind === 'picture').length
      if (held + drawing >= MOST_CHAT_PICTURES) {
        chat.trouble = `${name} was not added: a message takes up to 20 pictures.`
        return
      }
      drawing++
      void chatPicture(file)
        .then((image) => {
          if (image) addChip({ kind: 'picture', id: crypto.randomUUID(), label: name, image })
          else unread()
        })
        .finally(() => drawing--)
      return
    }
    if (file.size > 2_000_000) {
      refused()
      return
    }
    if (file.size > textRoom()) {
      tooMuchText(name)
      return
    }
    reading += file.size
    const reader = new FileReader()
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : ''
      if (text.includes('\u0000')) refused()
      else addChip({ kind: 'words', id: crypto.randomUUID(), label: file.name, text })
    }
    reader.onerror = unread
    reader.onloadend = () => (reading -= file.size)
    reader.readAsText(file)
  }

  function onPaste(event: ClipboardEvent) {
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length) {
      event.preventDefault()
      files.forEach(take)
      return
    }
    const text = longPaste(event)
    if (text === null) return
    const name = 'Text'
    if (text.length > 2_000_000) {
      chat.trouble = `${name} was not added: a chat takes pictures, and text files up to 2 MB.`
      return
    }
    if (text.length > textRoom()) {
      tooMuchText(name)
      return
    }
    addChip({ kind: 'words', id: crypto.randomUUID(), label: name, text })
  }

  function onDrop(event: DragEvent) {
    const files = [...(event.dataTransfer?.files ?? [])]
    if (!files.length) return
    event.preventDefault()
    files.forEach(take)
  }

  function modeMenu(event: MouseEvent) {
    const row = (mode: Mode) => ({
      label: modeWord(mode),
      checked: head?.mode === mode,
      run: () => chat.setMode(mode),
    })
    menu.show(event, [...MODES.filter((one) => one !== 'plan').map(row), DIVIDER, row('plan')], {
      title: 'Permissions',
    })
  }

  const mode = $derived(head?.mode ?? FIRST_MODE)

  const searching = $derived(chat.chips.some((one) => one.kind === 'web'))

  function toggleWeb() {
    if (searching) chat.chips = chat.chips.filter((one) => one.kind !== 'web')
    else addChip({ kind: 'web', id: 'web', label: 'Web search', word: 'web' })
  }

  function plusMenu(event: MouseEvent) {
    menu.show(event, [
      { label: 'Add photos and files', asks: true, run: chooseAndTake },
      DIVIDER,
      { label: 'Web search', checked: searching, run: toggleWeb },
      ...(canDictate() ? [{ label: 'Dictate', run: () => void dictation.toggle(true) }] : []),
      { label: 'Mention', run: () => typeAt('@') },
      { label: 'Commands', disabled: !!chat.text.trim(), run: () => typeAt('/') },
    ])
  }

  function typeAt(mark: string) {
    const at = field?.selectionStart ?? chat.text.length
    const before = chat.text.slice(0, at)
    const typed = mark === '@' && before && !/\s$/.test(before) ? ` ${mark}` : mark
    chat.text = before + typed + chat.text.slice(at)
    place(at + typed.length)
  }

  function chooseAndTake() {
    void chooseFiles({ multiple: true }).then((files) => {
      for (const file of files) take(file)
      chat.focus()
    })
  }

  const button = $derived.by((): 'stop' | 'send' => (busy && !chat.text.trim() ? 'stop' : 'send'))

  $effect(() => {
    if (chat.host !== here) return
    dictation.field = voiceField
    return () => {
      if (dictation.field === voiceField) dictation.field = null
    }
  })

  $effect(() => {
    if (chat.focusAsked && chat.host === here) requestAnimationFrame(() => field?.focus())
  })

  const thread = $derived(chat.head ? chat.thread : null)

  let escaped = 0

  const goal = $derived(
    head?.goal && (head.goal.state === 'pursuing' || head.goal.state === 'paused')
      ? head.goal
      : null,
  )
  let reasoning = $state(false)
  let now = $state(Date.now())

  $effect(() => {
    if (!goal) return
    const clock = setInterval(() => (now = Date.now()), 30_000)
    return () => clearInterval(clock)
  })

  async function clearGoal() {
    const named = rowNamed(await commandsFor(chat), 'goal')
    await named?.row.run({ args: 'clear', thread: chat.thread, panel: chat })
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="foot" bind:this={foot} onkeydown={footKey}>
  <Queue />

  {#if thread}
    <Rewinding {thread} panel={chat} />
  {/if}

  {#if chat.changing}
    <div class="editing" transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}>
      <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M8.7 2.3l2 2-6 6-2.6.6.6-2.6z" /></svg>
      <button class="drop" aria-label="Cancel" title="Cancel" onclick={() => chat.cancelEdit()}
        ><Cross small /></button
      >
    </div>
  {/if}

  {#if goal}
    <div
      class="goal"
      class:paused={goal.state === 'paused'}
      transition:fly={{ y: 6, duration: dur(150), easing: cubicOut }}
    >
      <button
        class="what"
        title={goal.condition}
        aria-expanded={reasoning}
        onclick={() => (reasoning = !reasoning)}
      >
        <span class="mark">◎</span>
        <span class="condition">{goal.condition}</span>
        <span class="meta"
          ><Facts
            line
            parts={[
              minutes(now - goal.started, region()),
              `${goal.turns}/${goal.budget.turns}`,
              tokens(goal.tokens, region()),
            ]}
          /></span
        >
      </button>
      <button class="drop" aria-label="Remove" title="Remove" onclick={() => void clearGoal()}
        ><Cross small /></button
      >
    </div>
    {#if reasoning && goal.reason}
      <p class="reason">{goal.reason}</p>
    {/if}
  {/if}

  <div class="box-wrap">
    {#if rows.length}
      <Suggest
        {rows}
        active={lit}
        onpick={(index: number) => pick(index)}
        onlight={(index: number) => (lit = index)}
      />
    {/if}
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div
      class="composer orden-field"
      onclick={(event) => {
        if (event.target === event.currentTarget) field?.focus()
      }}
    >
      {#if frontOn || selectionOn || chat.chips.length > 0}
        <div class="chips">
          {#if front && frontOn}
            <span class="chip implicit" title={front.path}>
              <MentionMark kind="note" />
              <span class="name" dir="auto">{front.name}</span>
              <button
                class="drop"
                aria-label="Remove"
                title="Remove"
                onclick={() => chat.drop(front.key)}><Cross small /></button
              >
            </span>
          {/if}
          {#if selectionOn}
            <span class="chip implicit" title={selection.slice(0, 400)}>
              <MentionMark kind="selection" />
              <span class="name quoted">{selection.trim().slice(0, 40)}</span>
              <button
                class="drop"
                aria-label="Remove"
                title="Remove"
                onclick={() => chat.drop(selectionKey)}><Cross small /></button
              >
            </span>
          {/if}
          {#each chat.chips as chip (chip)}
            <span
              class="chip"
              class:refused={chip.kind === 'picture' && chat.model?.images === false}
              title={chip.kind === 'picture' && chat.model?.images === false
                ? 'This model takes no pictures'
                : chip.label}
              transition:fly={{ y: 6, duration: dur(130), easing: cubicOut }}
            >
              {#if chip.image}
                <img
                  class="thumb"
                  alt=""
                  draggable="false"
                  src={`data:${chip.image.mime};base64,${chip.image.data}`}
                />
              {:else}
                <MentionMark kind={chip.kind} />
              {/if}
              <span class="name" dir="auto">{chip.label}</span>
              <button
                class="drop"
                aria-label="Remove"
                title="Remove"
                onclick={() => (chat.chips = chat.chips.filter((one) => !sameMention(one, chip)))}
                ><Cross small /></button
              >
            </span>
          {/each}
        </div>
      {/if}

      <textarea
        bind:this={field}
        bind:value={chat.text}
        use:grow={chat.text}
        use:dictating={voiceField}
        data-entry
        rows="1"
        placeholder="Ask anything, @ to add, / for more"
        aria-label="Ask about this space"
        onkeydown={onKey}
        oninput={onInput}
        onclick={onInput}
        onkeyup={onInput}
        onpaste={onPaste}
        ondrop={onDrop}></textarea>

      <div class="controls">
        <button
          class="orden-glyph plus"
          title="Add"
          aria-label="Add"
          aria-haspopup="menu"
          disabled={!head}
          onclick={plusMenu}
        >
          <svg viewBox="0 0 13 13" aria-hidden="true"><path d="M6.5 2.5v8M2.5 6.5h8" /></svg>
        </button>
        <button
          class="mode"
          title={mode === 'full'
            ? 'Full permissions: nothing is asked or handed back to you, not even signing in, paying, sending or deleting'
            : shortcuts.tooltip('Next mode', 'ai.mode')}
          aria-haspopup="menu"
          onclick={modeMenu}
          disabled={!head}
        >
          <ModeMark {mode} />
          <span>{modeWord(mode)}</span>
          <svg class="caret" viewBox="0 0 13 13"><path d="M3.8 5.2l2.7 2.7 2.7-2.7" /></svg>
        </button>
        <span class="gap"></span>
        <Ring {next} />
        <ModelPicker />
        {#if canDictate()}
          <DictateButton owner={voiceField} />
        {/if}
        {#if button === 'stop'}
          <button class="go" title="Stop" aria-label="Stop" onclick={() => chat.stop()}>
            <svg viewBox="0 0 13 13"
              ><rect class="square" x="4" y="4" width="5" height="5" rx="0.8" /></svg
            >
          </button>
        {:else if button === 'send'}
          <button
            class="go"
            title="Send"
            aria-label="Send"
            disabled={!chat.text.trim() && !chat.chips.length}
            onclick={() => void submit()}
          >
            <svg viewBox="0 0 13 13"><path d="M6.5 10.6V2.6M3.2 5.9l3.3-3.3 3.3 3.3" /></svg>
          </button>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .foot {
    position: relative;
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 100%;
    max-width: calc(var(--column, 100%) + 2 * var(--space-4));
    margin-inline: auto;
    padding: var(--space-1) var(--space-1) var(--space-2);
  }

  :global(.ask.wide) .foot {
    padding-inline: var(--space-4);
  }

  .editing {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 2px 2px 6px;
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    color: var(--accent);
  }

  .editing svg {
    width: 12px;
    height: 12px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.3;
    stroke-linejoin: round;
  }

  .goal {
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
    padding-inline-end: 2px;
    border: 1px solid var(--accent-line);
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
  }

  .goal.paused {
    border-color: var(--line);
    background: var(--ink-wash);
  }

  .goal .what {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 3px 6px;
    border: 0;
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: start;
    cursor: default;
  }

  .goal .mark {
    flex: none;
    color: var(--accent);
  }

  .goal.paused .mark {
    color: var(--muted);
  }

  .condition {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .goal .meta {
    flex: none;
    margin-inline-start: auto;
    color: var(--muted);
    font-size: var(--text-xs);
    font-variant-numeric: tabular-nums;
  }

  .reason {
    margin: 0;
    padding: 0 6px;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .box-wrap {
    position: relative;
  }

  .composer {
    flex-direction: column;
    align-items: stretch;
    gap: 2px;
    min-height: 0;
    padding: var(--space-2) var(--space-1) var(--space-1);
    border-radius: var(--radius-lg);
    background: var(--surface);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
    padding: 0 var(--space-1) 2px;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    max-width: 100%;
    height: 20px;
    padding: 0 2px 0 5px;
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    transition:
      opacity var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .chip.implicit {
    border-style: dashed;
    opacity: 0.7;
  }

  .chip.implicit:hover {
    opacity: 1;
  }

  .chip.refused {
    border-color: var(--danger);
    opacity: 0.6;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .quoted::before {
    content: '\201C';
  }

  .quoted::after {
    content: '\201D';
  }

  .thumb {
    width: 14px;
    height: 14px;
    border-radius: 2px;
    object-fit: cover;
  }

  .drop :global(svg) {
    width: 8px;
    height: 8px;
    stroke-width: 1.4;
  }

  .drop {
    display: grid;
    place-items: center;
    width: 14px;
    height: 14px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: var(--muted);
    font-size: var(--text-sm);
    line-height: 1;
    cursor: default;
  }

  @media (hover: hover) {
    .drop:hover {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  .composer textarea {
    flex: none;
    width: 100%;
    min-height: 1.45em;
    max-height: 12rem;
    padding: 2px var(--space-2) 4px;
    color: var(--text-strong);
    font-size: var(--text-row);
    line-height: 1.45;
    resize: none;
    field-sizing: content;
  }

  .controls {
    container-type: inline-size;
    display: flex;
    align-items: center;
    gap: 2px;
    min-width: 0;
  }

  .gap {
    flex: 1;
  }

  .plus {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
    border-radius: 50%;
  }

  .plus svg {
    stroke-width: 1.4;
  }

  .mode {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: var(--row-height-sm);
    padding: 0 4px 0 var(--space-1);
    border: 0;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .mode:hover:not(:disabled) {
      background: var(--surface-hover);
      color: var(--text-strong);
    }
  }

  @container (max-width: 17rem) {
    .mode span {
      display: none;
    }
  }

  .mode .caret {
    width: 11px;
    height: 11px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .go {
    flex: none;
    display: grid;
    place-items: center;
    width: 26px;
    height: 26px;
    margin-inline-start: 2px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: var(--text-strong);
    color: var(--bg);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      scale var(--dur-fast) var(--ease-out);
  }

  .go:disabled {
    background: var(--surface-hover);
    color: var(--muted);
  }

  .go:active:not(:disabled) {
    scale: 0.92;
  }

  .go svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .go .square {
    fill: currentColor;
    stroke: none;
  }

  :global([data-touch]) .composer textarea {
    font-size: var(--text-base);
  }
</style>

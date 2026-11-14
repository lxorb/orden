<script lang="ts">
  import type { Priority } from '@orden/markdown/task-line'
  import { parseQuickAdd, type QuickFields } from '@orden/bases/language'
  import { todayOf } from '@orden/bases'
  import { keepFocus } from '../focus'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Sparkles from 'lucide/dist/esm/icons/sparkles.mjs'
  import Tag from 'lucide/dist/esm/icons/tag.mjs'
  import Target from 'lucide/dist/esm/icons/target.mjs'
  import Timer from 'lucide/dist/esm/icons/timer.mjs'
  import { onMount, tick, untrack } from 'svelte'
  import DictateButton from '../dictation/DictateButton.svelte'
  import { canDictate } from '../dictation/engines.svelte'
  import { dictating } from '../dictation/keys'
  import type { Dictates } from '../dictation/voice.svelte'
  import { longPaste } from '../long-paste'
  import type { Provider } from '../ai/providers'
  import type { MenuEntry } from '../ui-kit/src/api'
  import type { Entry, Prefill } from './entry'
  import {
    carried,
    chosen,
    pastedLines,
    piecesOf,
    type Span,
    suggestions,
    tokenAt,
    without,
  } from './field'
  import Glyph from './Glyph.svelte'
  import { dayWords, durationLabel, priorityTone } from './labels'
  import Picker from './Picker.svelte'
  import { dayRows, durationRows, priorityRows, remindRows, tagRows } from './pickers'

  const {
    langs,
    tags = [],
    prefill = {},
    smart = true,
    mode = 'add',
    onsubmit,
    onclose,
    oncancel,
    onpicking,
    provider = null,
    dictates = true,
  }: {
    langs: readonly string[]
    tags?: readonly string[]
    prefill?: Prefill
    smart?: boolean
    mode?: 'add' | 'edit'
    onsubmit: (entry: Entry, open: boolean) => unknown
    onclose: () => void
    oncancel?: () => void
    onpicking?: (open: boolean) => void
    provider?: Provider | null
    dictates?: boolean
  } = $props()

  let text = $state(untrack(() => prefill.text ?? ''))
  let description = $state<string | null>(untrack(() => prefill.description ?? null))
  let keep = $state<Span[]>(untrack(() => [...(prefill.keep ?? [])]))
  let escaped = $state<Span[]>(untrack(() => [...(prefill.escaped ?? [])]))
  let picked = $state<{
    due?: string | null
    time?: string | null
    priority?: Priority
    remind?: QuickFields['remind']
    duration?: number | null
    deadline?: string | null
    tags?: string[]
  }>({})

  let input = $state<HTMLInputElement>()
  let mirror = $state<HTMLElement>()
  let words = $state<HTMLTextAreaElement>()
  let asking = $state<{ rows: MenuEntry[]; at: DOMRect } | null>(null)
  let pasted = $state<string[] | null>(null)

  let seen = untrack(() => prefill.text ?? '')

  const today = $derived(todayOf())
  const read = $derived(
    smart
      ? parseQuickAdd(text, langs, new Date(), { keep, escaped })
      : { text: text.trim(), fields: { tags: [], remind: [] }, chips: [] },
  )
  const pieces = $derived(piecesOf(text, read.chips))

  const fields = $derived.by((): QuickFields => {
    const given = prefill.fields ?? {}
    const out: QuickFields = {
      ...given,
      ...read.fields,
      tags: [...(prefill.tags ?? []), ...(given.tags ?? []), ...read.fields.tags],
      remind: read.fields.remind.length ? read.fields.remind : (given.remind ?? []),
    }
    for (const key of ['due', 'time', 'priority', 'deadline', 'duration', 'recurrence'] as const) {
      if (read.fields[key] === undefined && given[key] !== undefined) {
        Object.assign(out, { [key]: given[key] })
      }
    }
    if (out.due === undefined && prefill.due !== undefined) out.due = prefill.due
    if (picked.due === null) delete out.due
    else if (picked.due !== undefined) out.due = picked.due
    if (picked.time === null) delete out.time
    else if (picked.time !== undefined) out.time = picked.time
    if (picked.duration === null) delete out.duration
    else if (picked.duration !== undefined) out.duration = picked.duration
    if (picked.deadline === null) delete out.deadline
    else if (picked.deadline !== undefined) out.deadline = picked.deadline
    if (picked.priority !== undefined) out.priority = picked.priority
    if (picked.remind !== undefined) out.remind = picked.remind
    if (picked.tags !== undefined) out.tags = [...picked.tags, ...read.fields.tags]
    out.tags = [...new Set(out.tags)]
    return out
  })

  onMount(() => input?.focus())

  let spoken = $state<HTMLInputElement | HTMLTextAreaElement>()

  const voiceField: Dictates = {
    field: () => spoken ?? input,
    words: () => tags.slice(0, 12),
  }

  $effect(() => {
    const now = text
    if (now === seen) return
    keep = carried(keep, seen, now)
    escaped = carried(escaped, seen, now)
    seen = now
  })

  function follow() {
    if (input && mirror) mirror.scrollLeft = input.scrollLeft
    caret = input && input.selectionStart === input.selectionEnd ? (input.selectionStart ?? -1) : -1
  }

  let caret = $state(-1)
  let dismissed = $state(-1)
  let active = $state(0)

  const token = $derived(smart && caret >= 0 ? tokenAt(text, caret) : null)
  const offered = $derived.by((): string[] => {
    if (!token || token.from === dismissed) return []
    return suggestions(token.query, tags)
  })
  $effect.pre(() => {
    if (offered.length >= 0) active = 0
  })

  function take(value: string) {
    const field = input
    if (!token || !field) return
    const next = chosen(text, token, value)
    text = next.text
    void tick().then(() => {
      field.setSelectionRange(next.caret, next.caret)
      follow()
    })
  }

  function suggestKey(event: KeyboardEvent): boolean {
    if (!offered.length || event.isComposing) return false
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const by = event.key === 'ArrowDown' ? 1 : -1
      active = (active + by + offered.length) % offered.length
      return true
    }
    if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
      const one = offered[active]
      if (one === undefined) return false
      event.preventDefault()
      take(one)
      return true
    }
    if (event.key === 'Escape' && token) {
      event.preventDefault()
      event.stopPropagation()
      dismissed = token.from
      return true
    }
    return false
  }

  function pressed(event: PointerEvent) {
    if (!mirror) return
    for (const chip of mirror.querySelectorAll<HTMLElement>('[data-chip]')) {
      const box = chip.getBoundingClientRect()
      if (
        event.clientX >= box.left &&
        event.clientX <= box.right &&
        event.clientY >= box.top &&
        event.clientY <= box.bottom
      ) {
        const from = Number(chip.dataset.from)
        keep = [...keep, { from, to: from + chip.textContent.length }]
        return
      }
    }
  }

  function dropChip(kind: string) {
    const chip = read.chips.find((one) => one.kind === kind)
    if (!chip) return
    text = without(text, chip)
  }

  function ask(event: MouseEvent, rows: MenuEntry[]) {
    const target = event.currentTarget
    if (!(target instanceof HTMLElement)) return
    asking = { rows, at: target.getBoundingClientRect() }
  }

  $effect(() => onpicking?.(asking !== null))

  const anchor = () => asking?.at ?? input?.getBoundingClientRect() ?? new DOMRect()

  function askDay(event: MouseEvent) {
    ask(
      event,
      dayRows(
        fields,
        today,
        (when) => {
          dropChip('when')
          picked = {
            ...picked,
            due: when.due,
            ...(when.time === undefined ? {} : { time: when.time }),
          }
          input?.focus()
        },
        anchor,
      ),
    )
  }

  function askDeadline(event: MouseEvent) {
    ask(
      event,
      dayRows(
        { due: fields.deadline },
        today,
        (when) => {
          dropChip('deadline')
          picked = { ...picked, deadline: when.due }
          input?.focus()
        },
        anchor,
        false,
      ),
    )
  }

  function askPriority(event: MouseEvent) {
    ask(
      event,
      priorityRows(fields.priority ?? 4, (priority) => {
        dropChip('priority')
        picked = { ...picked, priority }
        input?.focus()
      }),
    )
  }

  function askTags(event: MouseEvent) {
    ask(
      event,
      tagRows(fields.tags, tags, (next) => {
        for (const chip of read.chips.filter((one) => one.kind === 'tag')) {
          const tag = text.slice(chip.from + 1, chip.to)
          if (!next.includes(tag)) text = without(text, chip)
        }
        picked = { ...picked, tags: next }
        input?.focus()
      }),
    )
  }

  function askRemind(event: MouseEvent) {
    ask(
      event,
      remindRows(fields.remind, fields, today, (remind) => {
        picked = { ...picked, remind }
        input?.focus()
      }),
    )
  }

  function askDuration(event: MouseEvent) {
    ask(
      event,
      durationRows(fields.duration, (duration) => {
        dropChip('duration')
        picked = { ...picked, duration }
        input?.focus()
      }),
    )
  }

  function entryOf(said: string, own: QuickFields): Entry | null {
    if (!said) return null
    const entry: Entry = { text: said, fields: own }
    if (description?.trim()) entry.description = description
    return entry
  }

  function clear() {
    text = ''
    seen = ''
    keep = []
    escaped = []
    picked = {}
    description = null
    input?.focus()
  }

  let thinking = $state(false)
  let sending = false

  async function handOver(entry: Entry, open: boolean, typed: string) {
    sending = true
    try {
      if ((await onsubmit(entry, open)) !== false && mode === 'add' && text === typed) clear()
    } finally {
      sending = false
    }
  }

  async function submit(open: boolean) {
    const entry = entryOf(read.text, fields)
    if (!entry || thinking || sending) return
    await handOver(entry, open, text)
  }

  async function submitAi(asked: Provider) {
    if (thinking || sending) return
    const typed = text
    thinking = true
    const { askedEntry } = await import('./ai-entry')
    const made = await askedEntry(asked, text.trim(), tags).catch(() => null)
    thinking = false
    if (!made) return submit(false)
    const own = { ...fields, ...made.fields, remind: fields.remind }
    own.tags = [...new Set([...fields.tags, ...made.fields.tags])]
    const entry = entryOf(made.text, own)
    if (!entry) return
    await handOver(entry, false, typed)
  }

  async function submitEach() {
    if (sending) return
    const lines = pasted ?? []
    pasted = null
    sending = true
    try {
      for (const [index, line] of lines.entries()) {
        const said = smart ? parseQuickAdd(line, langs, new Date()) : null
        const own: QuickFields = said
          ? { ...fields, ...said.fields, tags: [...new Set([...fields.tags, ...said.fields.tags])] }
          : fields
        const entry = entryOf(said ? said.text || line : line, own)
        if (entry && (await onsubmit(entry, false)) === false) {
          pasted = lines.slice(index)
          return
        }
      }
    } finally {
      sending = false
    }
    clear()
  }

  const LONG_TITLE = 10_000

  function onpaste(event: ClipboardEvent) {
    if (mode === 'add') {
      const lines = pastedLines(event.clipboardData?.getData('text/plain') ?? '')
      if (lines.length >= 2) {
        event.preventDefault()
        pasted = lines
        return
      }
    }
    const long = longPaste(event, LONG_TITLE)
    if (long === null) return
    description = description ? `${description}\n\n${long}` : long
  }

  function openDescription() {
    description ??= ''
    void tick().then(() => words?.focus())
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.currentTarget === input && suggestKey(event)) return
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      if (pasted) pasted = null
      else if (oncancel) oncancel()
      else onclose()
      return
    }
    if (event.key === 'ArrowDown' && event.currentTarget === input && !event.isComposing) {
      event.preventDefault()
      openDescription()
      return
    }
    if (event.key !== 'Enter' || event.isComposing) return
    if (event.shiftKey && event.currentTarget === input) {
      event.preventDefault()
      openDescription()
      return
    }
    if (event.shiftKey) return
    event.preventDefault()
    void submit(event.ctrlKey || event.metaKey)
  }

  function wordsKey(event: KeyboardEvent) {
    if (event.key === 'Backspace' && description === '') {
      event.preventDefault()
      description = null
      input?.focus()
      return
    }
    if (event.key === 'ArrowUp' && words?.selectionStart === 0) {
      event.preventDefault()
      input?.focus()
      return
    }
    onkeydown(event)
  }
</script>

<div class="quick" class:edit={mode === 'edit'}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="line" onpointerdown={pressed}>
    <div class="letters" bind:this={mirror} aria-hidden="true">
      {#each pieces as piece (piece.from)}{#if piece.chip}<span
            class="chip"
            data-chip={piece.chip}
            data-from={piece.from}>{piece.text}</span
          >{:else}{piece.text}{/if}{/each}&#8203;
    </div>
    <input
      bind:this={input}
      bind:value={text}
      use:dictating={voiceField}
      class="field"
      onfocus={() => (spoken = input)}
      {onkeydown}
      {onpaste}
      oninput={follow}
      onscroll={follow}
      onselect={follow}
      onkeyup={follow}
      placeholder="Add task"
      aria-label="Add task"
      spellcheck="false"
      autocomplete="off"
      aria-autocomplete="list"
      aria-expanded={offered.length > 0}
    />
    {#if offered.length}
      <div class="suggest" data-covers role="listbox" aria-label="Add task">
        {#each offered as one, index (one)}
          <button
            type="button"
            class="orden-row is-short"
            class:is-on={index === active}
            role="option"
            aria-selected={index === active}
            tabindex="-1"
            onpointerdown={keepFocus}
            onmousedown={keepFocus}
            onclick={() => take(one)}
          >
            <span class="orden-row-mark"><Glyph icon={Tag} /></span>
            <span class="orden-row-label">{one}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if description !== null}
    <textarea
      bind:this={words}
      bind:value={description}
      use:dictating={voiceField}
      class="words"
      onfocus={() => (spoken = words)}
      rows="2"
      placeholder="Description"
      onkeydown={wordsKey}
      aria-label="Description"></textarea>
  {/if}

  {#if pasted}
    <div class="pasted" role="group">
      <button type="button" class="control" onclick={() => (pasted = null)}>Cancel</button>
      <span class="gap"></span>
      <button
        type="button"
        class="control"
        onclick={() => {
          text = pasted?.join(' ') ?? text
          pasted = null
        }}>One task</button
      >
      <button type="button" class="add" onclick={() => void submitEach()}>One per line</button>
    </div>
  {:else}
    <div class="controls">
      <span class="gap"></span>
      <button
        type="button"
        class="control"
        class:set={fields.due !== undefined}
        onclick={askDay}
        aria-label={fields.due === undefined ? 'Start date' : undefined}
      >
        <Glyph icon={fields.recurrence ? Repeat : Calendar} />
        {#if fields.due !== undefined}<span>{dayWords(fields.due, today, fields.time)}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.deadline !== undefined}
        onclick={askDeadline}
        aria-label={fields.deadline === undefined ? 'Deadline' : undefined}
      >
        <Glyph icon={Target} />
        {#if fields.deadline !== undefined}<span>{dayWords(fields.deadline, today)}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={(fields.priority ?? 4) < 4}
        style:color={priorityTone(fields.priority ?? 4)}
        onclick={askPriority}
        aria-label="Priority"
      >
        <Glyph icon={Flag} />
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.tags.length > 0}
        onclick={askTags}
        aria-label="Labels"
      >
        <Glyph icon={Tag} />
        {#if fields.tags.length}<span>{fields.tags.length}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.remind.length > 0}
        onclick={askRemind}
        aria-label="Reminder"
      >
        <Glyph icon={Bell} />
        {#if fields.remind.length > 1}<span>{fields.remind.length}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.duration !== undefined}
        onclick={askDuration}
        aria-label={fields.duration === undefined ? 'Duration' : undefined}
      >
        <Glyph icon={Timer} />
        {#if fields.duration !== undefined}<span>{durationLabel(fields.duration)}</span>{/if}
      </button>
      {#if oncancel}
        <button type="button" class="control cancel" onclick={oncancel}>Cancel</button>
      {/if}
      {#if provider && mode === 'add'}
        <button
          type="button"
          class="control"
          disabled={!read.text || thinking}
          onclick={() => void submitAi(provider)}
          title="Add with AI"
        >
          <Glyph icon={Sparkles} />
        </button>
      {/if}
      {#if dictates && canDictate()}
        <DictateButton owner={voiceField} below />
      {/if}
      <button type="button" class="add" disabled={!read.text} onclick={() => void submit(false)}
        >{mode === 'edit' ? 'Save' : 'Add'}</button
      >
    </div>
  {/if}
</div>

{#if asking}
  <Picker rows={asking.rows} at={asking.at} onclose={() => (asking = null)} />
{/if}

<style>
  .quick {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }

  .line {
    position: relative;
  }

  .suggest {
    position: absolute;
    top: calc(100% + var(--space-1));
    inset-inline-start: 0;
    z-index: var(--z-popover);
    min-width: 14rem;
    max-width: 100%;
    padding: var(--space-1);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-md);
  }

  .letters,
  .field {
    box-sizing: border-box;
    width: 100%;
    padding: var(--space-1) var(--space-1);
    border: none;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: 1.5;
    letter-spacing: normal;
    white-space: pre;
  }

  .letters {
    position: absolute;
    inset: 0;
    overflow: hidden;
    color: var(--text-strong);
    pointer-events: none;
  }

  .field {
    position: relative;
    background: none;
    color: transparent;
    caret-color: var(--text-strong);
    outline: none;
  }

  .line {
    border-bottom: 1px solid var(--line);
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  .line:focus-within {
    border-bottom-color: var(--accent);
  }

  input.field:focus,
  textarea.words:focus {
    box-shadow: none;
  }

  .field::placeholder {
    color: var(--muted);
  }

  .field::selection {
    background: var(--accent-soft);
    color: transparent;
  }

  .chip {
    border-radius: var(--radius-sm);
    background: var(--accent-soft);
    box-shadow: 0 0 0 1px var(--accent-soft);
    color: var(--accent);
    transition:
      background var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  .words {
    box-sizing: border-box;
    width: 100%;
    min-height: 2.6em;
    padding: var(--space-1);
    border: none;
    border-top: 1px solid var(--line);
    background: none;
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-row);
    resize: none;
    outline: none;
  }

  .words::placeholder {
    color: var(--muted);
  }

  .controls,
  .pasted {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .gap {
    flex: 1;
  }

  .control {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    min-width: 0;
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .control:hover {
    background: var(--surface-hover);
    color: var(--text);
  }

  .control:active {
    background: var(--surface-press);
  }

  .control.set {
    color: var(--accent);
  }

  .cancel {
    margin-inline-start: var(--space-2);
    color: var(--text);
  }

  .add {
    min-height: var(--row-height-sm);
    margin-inline-start: var(--space-2);
    padding: 0 var(--space-3);
    border: none;
    border-radius: var(--radius-row);
    background: var(--accent);
    color: var(--accent-ink);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .cancel + .add {
    margin-inline-start: 0;
  }
</style>

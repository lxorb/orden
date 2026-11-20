<script lang="ts">
  import type { Priority } from '@orden/markdown/task-line'
  import { parseTodo, type QuickFields, type TypedTodo } from '@orden/bases/language'
  import { todayOf } from '@orden/bases'
  import type { MenuEntry } from '../../ui-kit/src/api'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Sparkles from 'lucide/dist/esm/icons/sparkles.mjs'
  import Tag from 'lucide/dist/esm/icons/tag.mjs'
  import Target from 'lucide/dist/esm/icons/target.mjs'
  import Timer from 'lucide/dist/esm/icons/timer.mjs'
  import { onMount, tick, untrack } from 'svelte'
  import type { Dictates } from '../../dictation/src/api'
  import { ChipInput, DateAsk, longPaste, type Spot, suggestions, type Token } from '../../ui-controls/src/api'
  import type { Provider } from '../../ai-providers/src/api'
  import type { Entry, Prefill } from './entry'
  import { pastedLines, without } from './field'
  import Glyph from './Glyph.svelte'
  import { priorityOf, priorityTone } from '../../tasks-model/src/api'
  import { dayWords, durationLabel } from './labels'
  import Picker from './Picker.svelte'
  import { type Ask, dayRows, durationRows, priorityRows, remindRows, tagRows } from './pickers'

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
  let keep = $state<Spot[]>(untrack(() => [...(prefill.keep ?? [])]))
  let escaped = $state<Spot[]>(untrack(() => [...(prefill.escaped ?? [])]))
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
  let words = $state<HTMLTextAreaElement>()
  let asking = $state<{ rows: MenuEntry[]; at: DOMRect } | null>(null)
  let pasted = $state<string[] | null>(null)
  const today = $derived(todayOf())
  const read = $derived(smart ? parseTodo(text, langs, new Date(), { keep, escaped }) : plainTodo(text))
  const fields = $derived.by((): QuickFields => {
    const given = prefill.fields ?? {}
    const out: QuickFields = {
      tags: [...(prefill.tags ?? []), ...(given.tags ?? []), ...read.labels],
      remind: picked.remind ?? given.remind ?? [],
    }
    if (given.time !== undefined) out.time = given.time
    if (given.duration !== undefined) out.duration = given.duration
    const due = read.start ?? given.due ?? prefill.due
    if (due !== undefined) out.due = due
    const deadline = read.deadline ?? given.deadline
    if (deadline !== undefined) out.deadline = deadline
    const priority = read.priority === undefined ? given.priority : quickPriority(read.priority)
    if (priority !== undefined) out.priority = priority
    const recurrence = read.repeat ?? given.recurrence
    if (recurrence !== undefined) out.recurrence = recurrence
    if (picked.due === null) delete out.due
    else if (picked.due !== undefined) out.due = picked.due
    if (picked.time === null) delete out.time
    else if (picked.time !== undefined) out.time = picked.time
    if (picked.duration === null) delete out.duration
    else if (picked.duration !== undefined) out.duration = picked.duration
    if (picked.deadline === null) delete out.deadline
    else if (picked.deadline !== undefined) out.deadline = picked.deadline
    if (picked.priority !== undefined) out.priority = picked.priority
    if (picked.tags !== undefined) out.tags = [...picked.tags, ...read.labels]
    out.tags = [...new Set(out.tags)]
    return out
  })
  const dictation = () => import('../../dictation/src/api')
  let speech = $state.raw<Awaited<ReturnType<typeof dictation>> | null>(null)
  onMount(() => {
    input?.focus()
    if (dictates) void dictation().then((one) => (speech = one))
  })
  function dictated(field: HTMLInputElement | HTMLTextAreaElement, owner: Dictates) {
    let held: { destroy(): void } | null = null
    let gone = !dictates
    if (!gone)
      void dictation().then((one) => {
        if (!gone) held = one.dictating(field, owner)
      })
    return {
      destroy() {
        gone = true
        held?.destroy()
      },
    }
  }
  let spoken = $state<HTMLInputElement | HTMLTextAreaElement>()
  const voiceField: Dictates = {
    field: () => spoken ?? input,
    words: () => tags.slice(0, 12),
  }
  $effect(() => {
    const field = input
    if (!field) return
    const held = dictated(field, voiceField)
    return () => held.destroy()
  })
  const offers = (token: Token) =>
    suggestions(token.query, tags).map((tag) => ({ value: tag, label: `${token.sign}${tag}`, kind: 'tag' }))
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
  const anchor = () => asking?.at ?? input?.getBoundingClientRect() ?? new DOMRect()
  let choosing = $state<{
    kind: 'date' | 'time'
    value: string
    at: DOMRect
    done: (value: string | null) => void
  } | null>(null)
  $effect(() => onpicking?.(asking !== null || choosing !== null))
  const choose: Ask = (kind, value) =>
    new Promise((settle) => {
      choosing = {
        kind,
        value: value ?? '',
        at: anchor(),
        done: (picked) => {
          choosing = null
          settle(picked)
        },
      }
    })
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
        choose,
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
        choose,
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
    const entry = entryOf(read.title, fields)
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
        const said = smart ? parseTodo(line, langs, new Date()) : null
        const own: QuickFields = said ? { ...fields, ...todoFields(said) } : fields
        if (said) own.tags = [...new Set([...fields.tags, ...said.labels])]
        const entry = entryOf(said ? said.title || line : line, own)
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
  function plainTodo(said: string): TypedTodo {
    return { title: said.trim(), labels: [], chips: [] }
  }
  function quickPriority(level: 0 | 1 | 2 | 3): Priority {
    return (4 - level) as Priority
  }
  function todoFields(said: TypedTodo): Partial<QuickFields> {
    const out: Partial<QuickFields> = {}
    if (said.start !== undefined) out.due = said.start
    if (said.deadline !== undefined) out.deadline = said.deadline
    if (said.priority !== undefined) out.priority = quickPriority(said.priority)
    if (said.repeat !== undefined) out.recurrence = said.repeat
    return out
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
  <div class="line" onfocusin={() => (spoken = input)}>
    <ChipInput
      bind:value={text}
      bind:kept={keep}
      bind:input
      chips={read.chips}
      signs={smart ? ['#', '@', '%'] : []}
      {offers}
      {onkeydown}
      {onpaste}
      placeholder="Add task"
      aria-label="Add task"
    />
  </div>

  {#if description !== null}
    <textarea
      bind:this={words}
      bind:value={description}
      use:dictated={voiceField}
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
        style:color={priorityTone(priorityOf(fields.priority))}
        onclick={askPriority}
        aria-label="Priority"
      >
        <Glyph icon={Flag} />
      </button>
      <button type="button" class="control" class:set={fields.tags.length > 0} onclick={askTags} aria-label="Labels">
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
          disabled={!read.title || thinking}
          onclick={() => void submitAi(provider)}
          title="Add with AI"
        >
          <Glyph icon={Sparkles} />
        </button>
      {/if}
      {#if dictates && speech?.canDictate()}
        <speech.DictateButton owner={voiceField} below />
      {/if}
      <button type="button" class="add" disabled={!read.title} onclick={() => void submit(false)}
        >{mode === 'edit' ? 'Save' : 'Add'}</button
      >
    </div>
  {/if}
</div>

{#if asking}
  <Picker rows={asking.rows} at={asking.at} onclose={() => (asking = null)} />
{/if}
{#if choosing}
  <DateAsk kind={choosing.kind} value={choosing.value} at={choosing.at} onpick={choosing.done} />
{/if}

<style>
  .quick {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
  }
  .line {
    border-bottom: 1px solid var(--line);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    line-height: 1.5;
    transition: border-color var(--dur-fast) var(--ease-out);
  }
  .line:focus-within {
    border-bottom-color: var(--accent);
  }
  textarea.words:focus {
    box-shadow: none;
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

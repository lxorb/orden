<script lang="ts">
  /** Quick add's field: one line, its recognised words drawn as chips where they were
   *  typed, and a row of controls under it that show what was understood and pick it
   *  for somebody who would rather click (docs/tasks.md 5.6).
   *
   *  The line is a plain input whose letters are drawn by the layer under it, so a chip
   *  can wear the accent's tint without the field becoming a rich-text editor: the input
   *  keeps the caret, the selection and every key a text field has. A chip pressed is
   *  words again (Todoist's undo), and Backspace into one takes it apart by changing its
   *  words.
   *
   *  A word typed after `#`, `@` or `%` is offered the space's labels, after `>` its
   *  notes, after `>Note/` that note's headings, as Todoist offers its projects, labels
   *  and sections: ↑ ↓ walk them, Enter or Tab takes one, Escape puts them away.
   *
   *  Enter adds and keeps the field for the next task, Shift+Enter or ↓ opens a line for
   *  the description, Ctrl+Enter adds and opens the note at the task, Escape closes.
   *  Several lines pasted at once ask whether they are one task or one each, Todoist's
   *  question. The same field edits a task where a view asks it to (`mode: 'edit'`),
   *  holding what the task says in its controls; a field in a list (`oncancel`) has the
   *  Cancel beside its button. What happens to the task is the caller's (`onsubmit`): the
   *  sheet writes it, a view writes or changes it, the global window hands it to the app. */
  import type { Priority } from '@nib/markdown/task-line'
  import { parseQuickAdd, type QuickFields } from '@nib/bases/language'
  import { todayOf } from '@nib/bases'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Hash from 'lucide/dist/esm/icons/heading.mjs'
  import Inbox from 'lucide/dist/esm/icons/inbox.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Tag from 'lucide/dist/esm/icons/tag.mjs'
  import Target from 'lucide/dist/esm/icons/target.mjs'
  import Timer from 'lucide/dist/esm/icons/timer.mjs'
  import { onMount, tick, untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import type { MenuEntry } from '../menu-item'
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
  import { dayRows, durationRows, priorityRows, remindRows, tagRows, whereRows } from './pickers'

  const {
    langs,
    notes = [],
    tags = [],
    prefill = {},
    smart = true,
    mode = 'add',
    onsubmit,
    onclose,
    oncancel,
    onpicking,
    headingsOf,
  }: {
    /** The app's language first; English is always read too. */
    langs: readonly string[]
    /** The space's notes by name, for `>` and the where control. */
    notes?: readonly string[]
    /** The labels the space's tasks already carry, for the labels control. */
    tags?: readonly string[]
    prefill?: Prefill
    /** Whether typed words are read as fields at all (Settings, Smart dates). */
    smart?: boolean
    /** Adding a task, or changing the one the prefill says. */
    mode?: 'add' | 'edit'
    onsubmit: (entry: Entry, open: boolean) => void | Promise<void>
    onclose: () => void
    /** A field standing in a list: Cancel beside its button. */
    oncancel?: () => void
    /** A picker opened or put away: the global window grows to hold it. */
    onpicking?: (open: boolean) => void
    /** A note's headings, by the name `>` gives it, for `/`. */
    headingsOf?: (note: string) => readonly string[]
  } = $props()

  // What the opener knew, taken once: the field is made again for every opening.
  let text = $state(untrack(() => prefill.text ?? ''))
  let description = $state<string | null>(untrack(() => prefill.description ?? null))
  /** Spans turned back into words. */
  let keep = $state<Span[]>([])
  /** What the controls picked, over whatever the words say. `null` takes a field away. */
  let picked = $state<{
    due?: string | null
    time?: string | null
    priority?: Priority
    remind?: QuickFields['remind']
    duration?: number | null
    deadline?: string | null
    tags?: string[]
    note?: string | null
  }>({})

  let input = $state<HTMLInputElement>()
  let mirror = $state<HTMLElement>()
  let words = $state<HTMLTextAreaElement>()
  let asking = $state<{ rows: MenuEntry[]; at: DOMRect } | null>(null)
  /** Lines pasted at once, waiting for the answer to one task or one each. */
  let pasted = $state<string[] | null>(null)

  /** The line as last seen, so the spans turned back follow an edit. */
  let seen = ''

  const today = $derived(todayOf())
  const read = $derived(
    smart
      ? parseQuickAdd(text, langs, new Date(), { keep, notes })
      : { text: text.trim(), fields: { tags: [], remind: [] }, chips: [] },
  )
  const pieces = $derived(piecesOf(text, read.chips))

  /** The fields as they will be written: the prefill, then the words, then the picks. */
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

  const note = $derived(
    picked.note === null ? undefined : (picked.note ?? read.note ?? prefill.note),
  )

  onMount(() => input?.focus())

  // The spans turned back into words move with the words around them.
  $effect(() => {
    const now = text
    if (now === seen) return
    keep = carried(keep, seen, now)
    seen = now
  })

  /** The layer of letters follows the field as a long line scrolls in it. */
  function follow() {
    if (input && mirror) mirror.scrollLeft = input.scrollLeft
    caret = input && input.selectionStart === input.selectionEnd ? (input.selectionStart ?? -1) : -1
  }

  /** Where the caret is in the line, or -1 while words are selected. */
  let caret = $state(-1)
  /** The word the suggestions were put away for, by where it starts. */
  let dismissed = $state(-1)
  let active = $state(0)

  const token = $derived(smart && caret >= 0 ? tokenAt(text, caret) : null)
  const offered = $derived.by((): string[] => {
    if (!token || token.from === dismissed) return []
    if (token.sign === '>') return suggestions(token.query, notes)
    if (token.sign === '/') {
      const start = text.lastIndexOf('>', token.from)
      const note = start === -1 ? '' : text.slice(start + 1, token.from).replace(/^"|"$/g, '')
      return note && headingsOf ? suggestions(token.query, headingsOf(note)) : []
    }
    return suggestions(token.query, tags)
  })
  // A new list of suggestions starts at its first.
  $effect.pre(() => {
    if (offered.length >= 0) active = 0
  })

  /** The suggestion chosen: its words in place of what was typed, the caret after it. */
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

  /** The keys the suggestions have while they are up; true when one was theirs. */
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

  /** A press on a chip makes it words again: Todoist's undo of a misread. */
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

  /** A control's pick wins over the words that said the same field: those words go,
   *  rather than staying in the task as words. */
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

  // Said as it changes, so a window no taller than its field can make room for the list.
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

  function askWhere(event: MouseEvent) {
    ask(
      event,
      whereRows(note, notes.slice(0, 12), (chosen) => {
        dropChip('where')
        picked = { ...picked, note: chosen ?? null }
        input?.focus()
      }),
    )
  }

  /** The entry the field holds now, or null while it holds no words. */
  function entryOf(said: string, own: QuickFields): Entry | null {
    if (!said) return null
    const entry: Entry = { text: said, fields: own }
    if (description?.trim()) entry.description = description
    if (note !== undefined) entry.note = note
    const heading = picked.note === undefined ? (read.heading ?? prefill.heading) : undefined
    if (heading !== undefined) entry.heading = heading
    return entry
  }

  function clear() {
    text = ''
    seen = ''
    keep = []
    picked = {}
    description = null
    input?.focus()
  }

  async function submit(open: boolean) {
    const entry = entryOf(read.text, fields)
    if (!entry) return
    if (mode === 'add') clear()
    await onsubmit(entry, open)
  }

  /** Several lines pasted: one task each, read the way a typed line is, with what the
   *  controls picked for all of them. */
  async function submitEach() {
    const lines = pasted ?? []
    pasted = null
    for (const line of lines) {
      const said = smart ? parseQuickAdd(line, langs, new Date(), { notes }) : null
      const own: QuickFields = said
        ? { ...fields, ...said.fields, tags: [...new Set([...fields.tags, ...said.fields.tags])] }
        : fields
      const entry = entryOf(said ? said.text || line : line, own)
      if (entry) await onsubmit(entry, false)
    }
    clear()
  }

  function onpaste(event: ClipboardEvent) {
    if (mode !== 'add') return
    const lines = pastedLines(event.clipboardData?.getData('text/plain') ?? '')
    if (lines.length < 2) return
    event.preventDefault()
    pasted = lines
  }

  function openDescription() {
    description ??= ''
    // The line is drawn on the next turn, and only then can it take the caret.
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

  /** Backspace on an empty description takes the line away again; ↑ at its first line
   *  goes back to the words. */
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
      class="field"
      {onkeydown}
      {onpaste}
      oninput={follow}
      onscroll={follow}
      onselect={follow}
      onkeyup={follow}
      placeholder={t('Add task')}
      aria-label={t('Add task')}
      spellcheck="false"
      autocomplete="off"
      aria-autocomplete="list"
      aria-expanded={offered.length > 0}
    />
    {#if offered.length}
      <div class="suggest" role="listbox" aria-label={t('Add task')}>
        {#each offered as one, index (one)}
          <button
            type="button"
            class="nib-row is-short"
            class:is-on={index === active}
            role="option"
            aria-selected={index === active}
            tabindex="-1"
            onpointerdown={(event) => event.preventDefault()}
            onclick={() => take(one)}
          >
            <span class="nib-row-mark"
              ><Glyph icon={token?.sign === '>' ? Inbox : token?.sign === '/' ? Hash : Tag} /></span
            >
            <span class="nib-row-label">{one}</span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if description !== null}
    <textarea
      bind:this={words}
      bind:value={description}
      class="words"
      rows="2"
      placeholder={t('Description')}
      onkeydown={wordsKey}
      aria-label={t('Description')}></textarea>
  {/if}

  {#if pasted}
    <div class="pasted" role="group">
      <button type="button" class="control" onclick={() => (pasted = null)}>{t('Cancel')}</button>
      <span class="gap"></span>
      <button
        type="button"
        class="control"
        onclick={() => {
          text = pasted?.join(' ') ?? text
          pasted = null
        }}>{t('One task')}</button
      >
      <button type="button" class="add" onclick={() => void submitEach()}
        >{t('One per line')}</button
      >
    </div>
  {:else}
    <div class="controls">
      {#if mode === 'add'}
        <button type="button" class="control" onclick={askWhere}>
          <Glyph icon={Inbox} />
          <span class="where">{note ? (note.split('/').at(-1) ?? note) : t('Inbox')}</span>
        </button>
      {/if}
      <span class="gap"></span>
      <button
        type="button"
        class="control"
        class:set={fields.due !== undefined}
        onclick={askDay}
        aria-label={fields.due === undefined ? t('Start date') : undefined}
      >
        <Glyph icon={fields.recurrence ? Repeat : Calendar} />
        {#if fields.due !== undefined}<span>{dayWords(fields.due, today, fields.time)}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.deadline !== undefined}
        onclick={askDeadline}
        aria-label={fields.deadline === undefined ? t('Deadline') : undefined}
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
        aria-label={t('Priority')}
      >
        <Glyph icon={Flag} />
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.tags.length > 0}
        onclick={askTags}
        aria-label={t('Labels')}
      >
        <Glyph icon={Tag} />
        {#if fields.tags.length}<span>{fields.tags.length}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.remind.length > 0}
        onclick={askRemind}
        aria-label={t('Reminder')}
      >
        <Glyph icon={Bell} />
        {#if fields.remind.length > 1}<span>{fields.remind.length}</span>{/if}
      </button>
      <button
        type="button"
        class="control"
        class:set={fields.duration !== undefined}
        onclick={askDuration}
        aria-label={fields.duration === undefined ? t('Duration') : undefined}
      >
        <Glyph icon={Timer} />
        {#if fields.duration !== undefined}<span>{durationLabel(fields.duration)}</span>{/if}
      </button>
      {#if oncancel}
        <button type="button" class="control cancel" onclick={oncancel}>{t('Cancel')}</button>
      {/if}
      <button type="button" class="add" disabled={!read.text} onclick={() => void submit(false)}
        >{mode === 'edit' ? t('Save') : t('Add')}</button
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

  /* The field and the layer of letters under it are one box: the same font, the same
     padding, the same width, so every letter the layer draws sits under the one the
     field holds. */
  .line {
    position: relative;
  }

  /* What a word could be, under the line, over whatever is below it. */
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

  /* The palette's line: a hairline under the words that turns when the keyboard
     lands, which is the answer a box you type into gives (base.css, Fields), and not
     the halo as well. */
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

  /* The accent's tint, padded by a shadow rather than by padding, which would move
     every letter after it away from the field's own. */
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

  .where {
    overflow: hidden;
    max-width: 10em;
    text-overflow: ellipsis;
    white-space: nowrap;
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

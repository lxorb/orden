<script lang="ts">
  /** Todoist's scheduler, nib's shapes: a field that reads a typed date with quick add's
   *  grammar and says what it understood; Today, Tomorrow, Later this week, This weekend,
   *  Next week and No date, each with its day; a month with today ringed, the day picked
   *  filled and a dot under every day that already holds tasks; and the time, the
   *  duration and the repeat, each a press away.
   *
   *  A day, a typed phrase and a repeat are picks that close it. The time and the
   *  duration are kept as they are changed, as every other setting in the app is, and
   *  it stays up for the next. Arrows walk the rows, Enter takes one, Escape closes. */
  import { addDays, addMonths } from '@nib/bases'
  import { dayWords, timeWords } from '@nib/editor/task-days'
  import ArrowRight from 'lucide/dist/esm/icons/arrow-right.mjs'
  import Briefcase from 'lucide/dist/esm/icons/briefcase.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import ChevronLeft from 'lucide/dist/esm/icons/chevron-left.mjs'
  import ChevronRight from 'lucide/dist/esm/icons/chevron-right.mjs'
  import CircleSlash from 'lucide/dist/esm/icons/circle-slash.mjs'
  import Clock from 'lucide/dist/esm/icons/clock.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Sofa from 'lucide/dist/esm/icons/sofa.mjs'
  import Sun from 'lucide/dist/esm/icons/sun.mjs'
  import { onMount, tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { fade, fly } from 'svelte/transition'
  import { closeOnBack } from '../../backstack.svelte'
  import Cross from '../../Cross.svelte'
  import { i18n, t } from '../../i18n.svelte'
  import type { IconNode } from '../../icons'
  import { LAYER } from '../../motion'
  import { overlays } from '../../overlays'
  import Glyph from '../../quick-add/Glyph.svelte'
  import { durationLabel } from '../../quick-add/labels'
  import { viewport } from '../../viewport.svelte'
  import { daysShown } from '../calendar'
  import { dateAt } from '../days'
  import {
    type QuickDay,
    quickDays,
    repeatKindOf,
    type RepeatKind,
    repeatRule,
    REPEATS,
    type Scheduled,
    typedWhen,
  } from './schedule'
  import { type Asked, besideBox } from './scheduling.svelte'

  const { asked, onclose }: { asked: Asked; onclose: () => void } = $props()

  // What the task says, kept here as it is changed so the time and the duration can be
  // set one after the other without the layer closing in between.
  // svelte-ignore state_referenced_locally
  let due = $state(asked.current.due)
  // svelte-ignore state_referenced_locally
  let time = $state(asked.current.time)
  // svelte-ignore state_referenced_locally
  let duration = $state(asked.current.minutes)
  // svelte-ignore state_referenced_locally
  const recurrence = asked.current.recurrence
  // svelte-ignore state_referenced_locally
  const today = asked.today

  let typed = $state('')
  let open = $state<'time' | 'repeat' | null>(null)
  // svelte-ignore state_referenced_locally
  let month = $state(`${(asked.current.due ?? asked.today).slice(0, 8)}01`)
  let cursor = $state(-1)

  let layer = $state<HTMLElement>()
  let field = $state<HTMLInputElement>()
  let size = $state({ width: 288, height: 460 })

  const phone = $derived(viewport.device === 'phone')
  const place = $derived(
    besideBox(asked.at, size, { width: window.innerWidth, height: window.innerHeight }),
  )

  const preview = $derived(typedWhen(typed, [i18n.language], new Date()))

  /** The first day of a week where the app's language keeps it, as the calendar has it. */
  const first = $derived.by(() => {
    try {
      // `getWeekInfo` is newer than the library types this is checked against.
      const locale = new Intl.Locale(i18n.language) as Intl.Locale & {
        getWeekInfo?: () => { firstDay?: number }
      }
      return (locale.getWeekInfo?.().firstDay ?? 1) % 7
    } catch {
      // A language tag the engine cannot read starts the week on Monday.
      return 1
    }
  })
  const days = $derived(daysShown('month', month, first))
  const weekdays = $derived(
    days.slice(0, 7).map((day) => i18n.when(dateAt(day), { weekday: 'narrow' })),
  )
  const monthName = $derived(i18n.when(dateAt(month), { month: 'long', year: 'numeric' }))

  const QUICK: Record<QuickDay, { icon: IconNode; label: string }> = {
    today: { icon: Calendar, label: t('Today') },
    tomorrow: { icon: Sun, label: t('Tomorrow') },
    later: { icon: Briefcase, label: t('Later this week') },
    weekend: { icon: Sofa, label: t('This weekend') },
    'next-weekend': { icon: Sofa, label: t('Next weekend') },
    'next-week': { icon: ArrowRight, label: t('Next week') },
  }
  const quick = $derived(quickDays(today))
  /** Every row the arrows walk: the quick days, then No date where there is a date. */
  const rows: { icon: IconNode; label: string; day: string | null }[] = $derived([
    ...quick.map((one) => ({ ...QUICK[one.kind], day: one.day })),
    ...(due ? [{ icon: CircleSlash, label: t('No date'), day: null }] : []),
  ])

  const DURATIONS = [15, 30, 45, 60, 90, 120, 180]

  /** A repeat's words for the day it repeats from. */
  function repeatLabel(kind: RepeatKind, day: string): string {
    const at = dateAt(day)
    switch (kind) {
      case 'daily':
        return t('Every day')
      case 'weekdays':
        return t('Every weekday')
      case 'weekly':
        return t('Every week on {day}', { day: i18n.when(at, { weekday: 'long' }) })
      case 'monthly':
        return t('Every month on day {day}', { day: Number(day.slice(8, 10)) })
      case 'yearly':
        return t('Every year on {date}', { date: i18n.when(at, { day: 'numeric', month: 'long' }) })
    }
  }
  const repeatDay = $derived(due ?? today)
  const repeatKind = $derived(repeatKindOf(recurrence, repeatDay))

  onMount(() => {
    // The keyboard goes back to the list it was opened from when the layer goes, so the
    // list still hears its keys and an undo straight after a pick is the pick undone. To
    // the row or the list rather than the button that asked: a button can go with what
    // it was about (Overdue's own, once nothing is overdue), and the keyboard with it.
    const before = document.activeElement
    const home = before?.closest('[role=option]') ?? before?.closest('[role=listbox]') ?? before
    if (layer) size = { width: layer.offsetWidth, height: layer.offsetHeight }
    // Under a thumb the system's keyboard would cover half of it for a field
    // nobody asked to type into.
    if (!phone) void tick().then(() => field?.focus())
    return () => {
      if (home instanceof HTMLElement && home.isConnected) home.focus({ preventScroll: true })
    }
  })

  $effect(() => closeOnBack(true, onclose))
  $effect(() => overlays.show(onclose))

  function pick(picked: Scheduled) {
    asked.pick(picked)
    onclose()
  }

  /** The time or the duration, kept as it changes, on the day the task has or today. */
  function keep(change: { time?: string | null; minutes?: number | null }) {
    const day = due ?? today
    due = day
    if (change.time !== undefined) time = change.time ?? undefined
    if (change.minutes !== undefined) duration = change.minutes ?? undefined
    asked.pick({ due: day, ...change })
  }

  function onkeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onclose()
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.target instanceof HTMLInputElement && event.target !== field) return
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      cursor = Math.max(-1, Math.min(rows.length - 1, cursor + step))
      if (cursor === -1) field?.focus()
      else layer?.querySelector<HTMLElement>(`[data-row="${cursor}"]`)?.focus()
      return
    }
    if (event.key === 'Enter' && event.target === field && preview) {
      event.preventDefault()
      pick(preview)
    }
  }

  function previewWords(when: Scheduled): string {
    const parts: string[] = []
    if (when.due) parts.push(dayWords(when.due, today, when.time ?? undefined))
    else if (when.time) parts.push(timeWords(when.time))
    if (when.minutes) parts.push(durationLabel(when.minutes))
    if (when.recurrence) parts.push(`↻ ${when.recurrence}`)
    return parts.join(' · ')
  }
</script>

<!-- A press anywhere else is the same answer as Escape. Under a thumb the sheet stands
     over the page the way every sheet does, the page dimmed behind it. -->
<div
  class="nib-scrim catch"
  class:is-clear={!phone}
  role="presentation"
  onpointerdown={onclose}
  transition:fade={{ duration: LAYER.fade }}
></div>
<div
  bind:this={layer}
  class="scheduler nib-layer"
  class:sheet={phone}
  role="dialog"
  aria-label={t('Date')}
  tabindex="-1"
  style:left={phone ? undefined : `${place.left}px`}
  style:top={phone ? undefined : `${place.top}px`}
  {onkeydown}
  transition:fly={{ y: phone ? 24 : 6, duration: LAYER.rise, easing: cubicOut }}
>
  <div class="typed">
    <input
      bind:this={field}
      bind:value={typed}
      class="field"
      placeholder={t('Type a date')}
      aria-label={t('Type a date')}
      spellcheck="false"
      autocomplete="off"
      onfocus={() => (cursor = -1)}
    />
    {#if preview}
      <button type="button" class="nib-row is-short preview" onclick={() => pick(preview)}>
        <span class="nib-row-mark"><Glyph icon={Calendar} /></span>
        <span class="nib-row-label">{previewWords(preview)}</span>
      </button>
    {/if}
  </div>

  <div class="quick" role="menu">
    {#each rows as row, index (row.label)}
      <button
        type="button"
        class="nib-row is-short"
        class:is-on={row.day !== null && row.day === due}
        role="menuitem"
        data-row={index}
        tabindex="-1"
        onfocus={() => (cursor = index)}
        onclick={() => pick({ due: row.day })}
      >
        <span class="nib-row-mark"><Glyph icon={row.icon} /></span>
        <span class="nib-row-label">{row.label}</span>
        {#if row.day}
          <span class="nib-row-meta"
            >{i18n.when(dateAt(row.day), {
              weekday: 'short',
              ...(row.day > addDays(today, 6) ? { day: 'numeric', month: 'short' } : {}),
            })}</span
          >
        {/if}
      </button>
    {/each}
  </div>

  <div class="month">
    <div class="month-head">
      <span class="month-name">{monthName}</span>
      <button
        type="button"
        class="nib-glyph step"
        aria-label={t('Previous month')}
        onclick={() => (month = addMonths(month, -1))}><Glyph icon={ChevronLeft} /></button
      >
      <button
        type="button"
        class="nib-glyph step today-dot"
        aria-label={t('Today')}
        onclick={() => (month = `${today.slice(0, 8)}01`)}><span class="dot"></span></button
      >
      <button
        type="button"
        class="nib-glyph step"
        aria-label={t('Next month')}
        onclick={() => (month = addMonths(month, 1))}><Glyph icon={ChevronRight} /></button
      >
    </div>
    <div class="grid" role="grid">
      {#each weekdays as name, index (index)}
        <span class="weekday" aria-hidden="true">{name}</span>
      {/each}
      {#each days as day (day)}
        <button
          type="button"
          class="day"
          class:outside={day.slice(0, 7) !== month.slice(0, 7)}
          class:past={day < today}
          class:today={day === today}
          class:picked={day === due}
          aria-label={i18n.when(dateAt(day), { dateStyle: 'full' })}
          aria-pressed={day === due}
          onclick={() => pick({ due: day })}
          >{Number(day.slice(8, 10))}{#if (asked.load.get(day) ?? 0) > 0}<span
              class="load"
              aria-hidden="true"
            ></span>{/if}</button
        >
      {/each}
    </div>
  </div>

  <div class="extras">
    <button
      type="button"
      class="extra"
      class:set={time !== undefined}
      aria-expanded={open === 'time'}
      onclick={() => (open = open === 'time' ? null : 'time')}
    >
      <Glyph icon={Clock} />
      <span
        >{time === undefined ? t('Time') : timeWords(time)}{#if duration !== undefined}
          · {durationLabel(duration)}{/if}</span
      >
    </button>
    <button
      type="button"
      class="extra"
      class:set={recurrence !== undefined}
      aria-expanded={open === 'repeat'}
      onclick={() => (open = open === 'repeat' ? null : 'repeat')}
    >
      <Glyph icon={Repeat} />
      <span
        >{recurrence === undefined
          ? t('Repeat')
          : repeatKind
            ? repeatLabel(repeatKind, repeatDay)
            : recurrence}</span
      >
    </button>
  </div>

  {#if open === 'time'}
    <div class="panel">
      <div class="time-line">
        <input
          type="time"
          class="time"
          value={time ?? ''}
          aria-label={t('Time')}
          onchange={(event) => keep({ time: event.currentTarget.value || null })}
        />
        {#if time !== undefined}
          <button
            type="button"
            class="nib-glyph"
            aria-label={t('No time')}
            onclick={() => keep({ time: null })}><Cross /></button
          >
        {/if}
      </div>
      <div class="durations" role="group" aria-label={t('Duration')}>
        {#each DURATIONS as minutes (minutes)}
          <button
            type="button"
            class="nib-chip"
            class:is-on={duration === minutes}
            aria-pressed={duration === minutes}
            onclick={() => keep({ minutes: duration === minutes ? null : minutes })}
            >{durationLabel(minutes)}</button
          >
        {/each}
      </div>
    </div>
  {:else if open === 'repeat'}
    <div class="panel" role="menu">
      {#each REPEATS as kind (kind)}
        <button
          type="button"
          class="nib-row is-short"
          class:is-on={repeatKind === kind}
          role="menuitemradio"
          aria-checked={repeatKind === kind}
          onclick={() => pick({ due: repeatDay, recurrence: repeatRule(kind, repeatDay) })}
        >
          <span class="nib-row-label">{repeatLabel(kind, repeatDay)}</span>
        </button>
      {/each}
      {#if recurrence !== undefined}
        <button
          type="button"
          class="nib-row is-short"
          role="menuitem"
          onclick={() => pick({ due: repeatDay, recurrence: null })}
        >
          <span class="nib-row-label">{t('No repeat')}</span>
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .catch {
    --scrim-z: var(--z-menu);
  }

  .scheduler {
    position: fixed;
    z-index: var(--z-menu);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: 18rem;
    max-height: calc(100vh - 16px);
    padding: var(--space-2);
    overflow-y: auto;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    outline: none;
  }

  .scheduler.sheet {
    inset: auto 0 0;
    width: auto;
    max-height: 85vh;
    padding-bottom: calc(var(--space-3) + var(--inset-bottom, 0px));
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }

  .typed {
    display: flex;
    flex-direction: column;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--line);
  }

  .field {
    box-sizing: border-box;
    width: 100%;
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text-strong);
    font: inherit;
    outline: none;
  }

  .field::placeholder {
    color: var(--muted);
  }

  .preview {
    color: var(--accent);
  }

  .quick {
    display: flex;
    flex-direction: column;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--line);
  }

  .month-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    padding: var(--space-1) var(--row-pad);
  }

  .month-name {
    flex: 1;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  .step {
    width: var(--row-height-sm);
    height: var(--row-height-sm);
  }

  .dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
    padding: 0 var(--space-1) var(--space-1);
  }

  .weekday {
    padding: 2px 0;
    color: var(--muted);
    font-size: var(--text-xs);
    text-align: center;
  }

  .day {
    position: relative;
    display: grid;
    place-items: center;
    aspect-ratio: 1;
    padding: 0;
    border: none;
    border-radius: 50%;
    background: none;
    color: var(--text);
    font: inherit;
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .day.outside,
  .day.past {
    color: var(--muted);
  }

  .day.today {
    box-shadow: inset 0 0 0 1px var(--accent);
    color: var(--accent);
  }

  .day.picked {
    background: var(--accent);
    color: var(--accent-ink);
  }

  @media (hover: hover) {
    .day:not(.picked):hover {
      background: var(--surface-hover);
    }
  }

  .day:active {
    background: var(--surface-press);
  }

  .load {
    position: absolute;
    bottom: 3px;
    left: 50%;
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
    transform: translateX(-50%);
  }

  .extras {
    display: flex;
    gap: var(--space-1);
    padding-top: var(--space-1);
    border-top: 1px solid var(--line);
  }

  .extra {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-1);
    min-width: 0;
    min-height: var(--row-height-sm);
    padding: 0 var(--space-2);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted-strong);
    font: inherit;
    font-size: var(--text-xs);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .extra span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .extra.set {
    color: var(--accent);
    border-color: var(--accent-line);
  }

  @media (hover: hover) {
    .extra:hover {
      background: var(--surface-hover);
    }
  }

  .extra:active {
    background: var(--surface-press);
  }

  .panel {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding-top: var(--space-1);
  }

  .time-line {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .time {
    flex: 1;
    min-height: var(--row-height);
    padding: 0 var(--row-pad);
    border: 1px solid var(--line);
    border-radius: var(--radius-row);
    background: var(--bg);
    color: var(--text-strong);
    font: inherit;
  }

  .durations {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }
</style>

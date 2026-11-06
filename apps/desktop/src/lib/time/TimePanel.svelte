<script lang="ts">
  import { ACCENTS, accentColour, accentFor } from '../accents'
  import { i18n, t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { segmented } from '../slide'
  import { prompt } from '../prompt.svelte'
  import { theme } from '../theme.svelte'
  import {
    dayOf,
    daysAfter,
    endOf,
    lasting,
    MINUTE,
    piecesIn,
    type Range,
    startOf,
    stepped,
    ticking,
    totalsOf,
    wholeOf,
  } from './days'
  import type { Activity } from './records'
  import SpanEditor from './SpanEditor.svelte'
  import './start.svelte'
  import { time } from './time.svelte'

  let range = $state<Range>('day')
  let start = $state(startOf('day', Date.now()))
  let now = $state(Date.now())
  let editing = $state<string | null>(null)
  let naming = $state(false)
  let name = $state('')

  $effect(() => {
    const every = time.running.length ? 1000 : 30 * 1000
    const timer = setInterval(() => (now = Date.now()), every)
    return () => clearInterval(timer)
  })

  $effect(() => {
    void time.exchange()
  })

  const end = $derived(endOf(range, start))
  const pieces = $derived(piecesIn(time.spans, start, end, now))
  const totals = $derived(totalsOf(pieces))
  const whole = $derived(wholeOf(pieces))
  const current = $derived(startOf(range, now) === start)
  const chips = $derived(time.latest().slice(0, 6))

  const days = $derived.by(() => {
    if (range === 'day') return []
    const out: { day: number; whole: number; totals: ReturnType<typeof totalsOf> }[] = []
    for (let day = start; day < end; day = daysAfter(day, 1)) {
      const inDay = piecesIn(time.spans, day, daysAfter(day, 1), now)
      out.push({ day, whole: wholeOf(inDay), totals: totalsOf(inDay) })
    }
    return out
  })
  const longest = $derived(Math.max(1, ...days.map((one) => one.whole)))

  const tintOf = (id: string | null): string => {
    const activity = time.activity(id)
    if (!activity) return 'var(--muted)'
    return activity.tint
      ? accentColour(activity.tint, theme.current)
      : accentFor(activity.name, theme.current)
  }

  const nameOf = (id: string | null) => time.activity(id)?.name ?? t('No activity')

  const titled = $derived(
    range === 'month'
      ? i18n.when(start, { month: 'long', year: 'numeric' })
      : range === 'week'
        ? `${i18n.when(start, { day: 'numeric', month: 'short' })} – ${i18n.when(daysAfter(end, -1), { day: 'numeric', month: 'short' })}`
        : i18n.when(start, { weekday: 'short', day: 'numeric', month: 'short' }),
  )

  const clock = (at: number) => i18n.when(at, { hour: '2-digit', minute: '2-digit' })

  function chosen(next: Range) {
    const from = current ? Date.now() : start
    range = next
    start = startOf(next, from)
    editing = null
  }

  function made() {
    const said = name.trim()
    naming = false
    name = ''
    if (!said) return
    const tint = ACCENTS[time.activities.length % ACCENTS.length]?.id ?? null
    time.start(time.addActivity(said, tint).id)
  }

  function added() {
    const at = Math.min(Date.now(), end)
    const from = Math.max(start, at - 30 * MINUTE)
    editing = time.addSpan({ start: from, end: at, activity: chips[0]?.id ?? null }).id
  }

  function activityMenu(event: MouseEvent, activity: Activity) {
    event.preventDefault()
    menu.show(
      event,
      [
        {
          label: t('Rename'),
          run: () =>
            void prompt
              .ask({ title: t('Rename'), value: activity.name, confirmLabel: t('Rename') })
              .then((next) => {
                if (next?.trim()) time.changeActivity(activity.id, { name: next })
              }),
        },
        ...ACCENTS.map((accent) => ({
          label: t(accent.name),
          checked: activity.tint === accent.id,
          run: () => time.changeActivity(activity.id, { tint: accent.id }),
        })),
        null,
        {
          label: t('Archive'),
          checked: activity.archived,
          run: () => time.changeActivity(activity.id, { archived: !activity.archived }),
        },
        { label: t('Delete'), danger: true, run: () => time.removeActivity(activity.id) },
      ],
      { title: activity.name },
    )
  }
</script>

<div class="time">
  {#each time.running as span (span.id)}
    <div class="running">
      <span class="dot" style:background={tintOf(span.activity)}></span>
      <span class="nib-row-label">{nameOf(span.activity)}</span>
      <span class="tick">{ticking(now - span.start)}</span>
      <button type="button" class="nib-chip" onclick={() => time.stop()}>{t('Stop timer')}</button>
    </div>
  {/each}

  <div class="chips" role="group" aria-label={t('Start timer')}>
    {#each chips as one (one.id)}
      <button
        type="button"
        class="nib-chip activity"
        class:on={time.running.some((span) => span.activity === one.id)}
        style:--tint={tintOf(one.id)}
        onclick={() => time.start(one.id)}
        oncontextmenu={(event) => activityMenu(event, one)}
        ><span class="dot"></span>{one.name}</button
      >
    {/each}
    {#if naming}
      <!-- svelte-ignore a11y_autofocus -->
      <input
        class="nib-field naming"
        aria-label={t('New activity')}
        placeholder={t('New activity')}
        autofocus
        bind:value={name}
        onblur={made}
        onkeydown={(event) => {
          if (event.key === 'Enter') made()
          if (event.key === 'Escape') {
            name = ''
            naming = false
          }
        }}
      />
    {:else}
      <button
        type="button"
        class="nib-chip"
        title={t('New activity')}
        aria-label={t('New activity')}
        onclick={() => (naming = true)}>+</button
      >
    {/if}
  </div>

  <div class="nib-segmented" role="radiogroup" aria-label={t('Time tracker')} use:segmented>
    {#each [['day', t('Day')], ['week', t('Week')], ['month', t('Month')]] as const as [id, label] (id)}
      <button
        type="button"
        role="radio"
        aria-checked={range === id}
        class:on={range === id}
        onclick={() => chosen(id)}>{label}</button
      >
    {/each}
  </div>

  <div class="moving">
    <button
      type="button"
      class="nib-chip"
      aria-label={t('Previous')}
      onclick={() => (start = stepped(range, start, -1))}>‹</button
    >
    <button
      type="button"
      class="title"
      disabled={current}
      title={t('Today')}
      onclick={() => (start = startOf(range, Date.now()))}>{titled}</button
    >
    <button
      type="button"
      class="nib-chip"
      aria-label={t('Next')}
      onclick={() => (start = stepped(range, start, 1))}>›</button
    >
  </div>

  {#if range === 'day'}
    <div class="strip" aria-hidden="true">
      {#each pieces as piece (piece.span.id)}
        <span
          style:left="{((piece.from - start) / (end - start)) * 100}%"
          style:width="{Math.max(0.3, ((piece.to - piece.from) / (end - start)) * 100)}%"
          style:background={tintOf(piece.span.activity)}
        ></span>
      {/each}
    </div>
    <ul class="spans">
      {#each pieces as piece (piece.span.id)}
        <li>
          <button
            type="button"
            class="nib-row is-short"
            aria-expanded={editing === piece.span.id}
            onclick={() => (editing = editing === piece.span.id ? null : piece.span.id)}
          >
            <span class="dot" style:background={tintOf(piece.span.activity)}></span>
            <span class="nib-row-meta clock"
              >{clock(piece.span.start)}–{piece.span.end === null
                ? ''
                : clock(piece.span.end)}</span
            >
            <span class="nib-row-label">{nameOf(piece.span.activity)}</span>
            <span class="nib-row-meta">{lasting(piece.to - piece.from)}</span>
          </button>
          {#if editing === piece.span.id}
            <SpanEditor span={piece.span} ondone={() => (editing = null)} />
          {/if}
        </li>
      {/each}
    </ul>
    <button type="button" class="nib-chip add" onclick={added}>{t('Add')}</button>
  {:else}
    <ul class="days">
      {#each days as one (one.day)}
        <li class:today={one.day === dayOf(now)}>
          <span class="nib-row-meta day"
            >{i18n.when(
              one.day,
              range === 'week' ? { weekday: 'short' } : { day: 'numeric' },
            )}</span
          >
          <span class="bar">
            {#each one.totals as total (total.activity)}
              <span
                style:width="{(total.ms / longest) * 100}%"
                style:background={tintOf(total.activity)}
              ></span>
            {/each}
          </span>
          <span class="nib-row-meta">{one.whole ? lasting(one.whole) : ''}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if totals.length}
    <p class="nib-section">{t('Activity')}<span>{lasting(whole)}</span></p>
    <ul class="totals">
      {#each totals as total (total.activity)}
        {@const activity = time.activity(total.activity)}
        <li>
          <button
            type="button"
            class="nib-row is-short"
            oncontextmenu={(event) => activity && activityMenu(event, activity)}
            onclick={() => activity && time.start(activity.id)}
          >
            <span class="dot" style:background={tintOf(total.activity)}></span>
            <span class="nib-row-label">{nameOf(total.activity)}</span>
            <span class="share"
              ><span
                style:width="{(total.ms / whole) * 100}%"
                style:background={tintOf(total.activity)}
              ></span></span
            >
            <span class="nib-row-meta">{lasting(total.ms)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .time {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--tint, var(--muted));
  }

  .running {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    padding: var(--space-2) var(--row-pad);
    border-radius: var(--radius-row);
    background: var(--surface-2);
  }

  .tick {
    font-variant-numeric: tabular-nums;
    color: var(--text-strong);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .activity {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .activity.on {
    border-color: var(--tint);
    color: var(--text-strong);
  }

  .naming {
    width: auto;
    flex: 1 1 8em;
    min-height: 0;
  }

  .moving {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .title {
    flex: 1;
    min-width: 0;
    padding: var(--space-1);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--text-strong);
    font: inherit;
    font-size: var(--text-sm);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .title:disabled {
    color: var(--muted-strong);
  }

  .strip {
    position: relative;
    height: 10px;
    border-radius: var(--radius-sm);
    background: var(--surface-2);
    overflow: hidden;
  }

  .strip span {
    position: absolute;
    top: 0;
    bottom: 0;
  }

  .clock {
    font-variant-numeric: tabular-nums;
  }

  .add {
    align-self: flex-start;
  }

  .days li {
    display: grid;
    grid-template-columns: 3.5em 1fr 3.5em;
    align-items: center;
    gap: var(--space-2);
    min-height: 22px;
  }

  .days li.today .day {
    color: var(--text-strong);
  }

  .bar,
  .share {
    display: flex;
    height: 8px;
    border-radius: var(--radius-sm);
    overflow: hidden;
  }

  .share {
    flex: 0 1 30%;
    background: var(--surface-2);
  }

  .days .nib-row-meta:last-child,
  .totals .nib-row-meta {
    font-variant-numeric: tabular-nums;
    text-align: end;
  }
</style>

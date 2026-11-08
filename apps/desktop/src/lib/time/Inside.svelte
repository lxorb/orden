<script lang="ts">
  import { t } from '../i18n.svelte'
  import { atClock, clockOf, dayOf, daysAfter } from './days'
  import { type Picked, type Stretch, within } from './lanes'
  import { clock, length, nameOf, placeTint, tintOf } from './look'
  import type { Minute } from './minutes'
  import type { Span } from './records'
  import { time } from './time.svelte'

  const {
    picked,
    spans,
    minutes,
    now,
    loose,
    whole = false,
    title = null,
    onpick,
  }: {
    picked: Picked
    spans: readonly Span[]
    minutes: readonly Minute[]
    now: number
    loose: readonly Stretch[]
    whole?: boolean
    title?: string | null
    onpick: (next: Picked) => void
  } = $props()

  const found = $derived(within(spans, minutes, picked.from, picked.to, now))
  const entry = $derived(picked.span ? time.span(picked.span) : null)
  const lasted = $derived(picked.to - picked.from)
  const share = (ms: number) => (lasted > 0 ? Math.min(1, ms / lasted) : 0)
  const part = (ms: number, list: readonly { ms: number }[]) =>
    whole ? ms / list.map((one) => one.ms).reduce((high, one) => Math.max(high, one), 1) : share(ms)
  const groups = $derived(
    (
      [
        ['app', t('Apps')],
        ['site', t('Websites')],
        ['space', t('Spaces')],
        ['tab', t('Tabs')],
      ] as const
    )
      .map(([lane, label]) => ({ lane, label, list: found.places[lane].slice(0, 5) }))
      .filter((one) => one.list.length),
  )

  function recordAs(activity: string) {
    const span = time.addSpan({ start: picked.from, end: picked.to, activity })
    onpick({ from: span.start, to: span.end ?? picked.to, span: span.id })
  }

  function moved(which: 'start' | 'end', value: string) {
    const span = entry
    if (!span) return
    const day = dayOf(span.start)
    const at = atClock(day, value)
    if (at === null) return
    const end = which === 'end' && at < span.start ? atClock(daysAfter(day, 1), value) : at
    if (end === null) return
    time.changeSpan(span.id, which === 'start' ? { start: end } : { end })
    const next = time.span(span.id)
    if (next) onpick({ from: next.start, to: next.end ?? now, span: next.id })
  }
</script>

<div class="inside">
  <p class="range">
    <span>{title ?? `${clock(picked.from)}–${clock(picked.to)}`}</span>
    <span class="long">{whole ? length(found.saidMs) : length(lasted)}</span>
  </p>

  {#if entry}
    <div class="entry">
      <select
        class="orden-field"
        aria-label={t('Activity')}
        value={entry.activity ?? ''}
        onchange={(event) =>
          time.changeSpan(entry.id, { activity: event.currentTarget.value || null })}
      >
        <option value="">{t('No activity')}</option>
        {#each time.activities.filter((one) => !one.archived || one.id === entry.activity) as one (one.id)}
          <option value={one.id}>{one.name}</option>
        {/each}
      </select>
      <div class="clocks">
        <input
          class="orden-field"
          type="time"
          aria-label={t('Start time')}
          value={clockOf(entry.start)}
          onchange={(event) => moved('start', event.currentTarget.value)}
        />
        <input
          class="orden-field"
          type="time"
          aria-label={t('End time')}
          value={entry.end === null ? '' : clockOf(entry.end)}
          disabled={entry.end === null}
          onchange={(event) => moved('end', event.currentTarget.value)}
        />
      </div>
      <input
        class="orden-field"
        aria-label={t('Note')}
        placeholder={t('Note')}
        value={entry.note}
        onchange={(event) => time.changeSpan(entry.id, { note: event.currentTarget.value })}
      />
      <div class="acts">
        <button
          type="button"
          class="orden-chip"
          onclick={() => entry.activity && time.start(entry.activity)}>{t('Continue')}</button
        >
        <button
          type="button"
          class="orden-chip"
          onclick={() => {
            time.removeSpan(entry.id)
            onpick({ ...picked, span: null })
          }}>{t('Delete')}</button
        >
      </div>
    </div>
  {:else if !whole}
    <p class="orden-section">{t('Record this as')}</p>
    <div class="chips">
      {#each time.latest().slice(0, 8) as one (one.id)}
        <button
          type="button"
          class="orden-chip as"
          style:--tint={tintOf(one.id)}
          onclick={() => recordAs(one.id)}><span class="dot"></span>{one.name}</button
        >
      {/each}
    </div>
  {/if}

  <p class="orden-section">{t('Active')}<span>{length(found.active)}</span></p>
  <div
    class="orden-meter"
    role="meter"
    aria-label={t('Active')}
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(share(found.active) * 100)}
  >
    <div class="orden-meter-fill" style:width="{share(found.active) * 100}%"></div>
  </div>

  {#if found.said.length && !entry}
    <p class="orden-section">{t('You said')}<span>{length(found.saidMs)}</span></p>
    <ul>
      {#each found.said as total (total.activity)}
        <li>
          <span class="dot" style:background={tintOf(total.activity)}></span>
          <span class="label" dir="auto">{nameOf(total.activity, t('No activity'))}</span>
          <span class="meta">{length(total.ms)}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#each groups as group (group.lane)}
    <p class="orden-section">{group.label}</p>
    <ul>
      {#each group.list as place (place.key)}
        <li>
          <span class="dot" style:background={placeTint(place.key)}></span>
          <span class="label" dir="auto">{place.name}</span>
          <span class="bar"
            ><span
              style:width="{part(place.ms, group.list) * 100}%"
              style:background={placeTint(place.key)}
            ></span></span
          >
          <span class="meta">{length(place.ms)}</span>
        </li>
      {/each}
    </ul>
  {/each}

  {#if loose.length && whole}
    <p class="orden-section">{t('Not said')}</p>
    <ul>
      {#each loose as stretch (stretch.from)}
        <li>
          <button
            type="button"
            class="orden-row is-short"
            onclick={() => onpick({ from: stretch.from, to: stretch.to, span: null })}
          >
            <span class="orden-row-label">{clock(stretch.from)}–{clock(stretch.to)}</span>
            <span class="orden-row-meta">{length(stretch.to - stretch.from)}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .inside {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .range {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin: 0;
    color: var(--text-strong);
    font-size: 1.05rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }

  .long {
    color: var(--muted-strong);
    font-size: var(--text-sm);
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .clocks {
    display: flex;
    gap: var(--space-2);
  }

  .acts,
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
  }

  .as {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .as .dot {
    background: var(--tint);
  }

  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }

  li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 22px;
    font-size: var(--text-sm);
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  .label {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bar {
    flex: 0 0 25%;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--surface-2);
  }

  .bar span {
    display: block;
    height: 100%;
  }

  .meta {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  [dir='auto'] {
    text-align: match-parent;
  }
</style>

<script lang="ts">
  import { ACCENTS } from '../accents'
  import { i18n, t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { prompt } from '../prompt.svelte'
  import { type Place, placesOf } from './counted'
  import { daysAfter, lasting, piecesIn, totalsOf, wholeOf } from './days'
  import { lengthIn } from './goals'
  import { madeOf } from './lanes'
  import { length, nameOf, placeTint, tintOf } from './look'
  import type { Minute } from './minutes'
  import type { Activity, Lane, Per, Span } from './records'
  import { time } from './time.svelte'

  const {
    from,
    to,
    spans,
    own,
    minutes,
    now,
    onday,
  }: {
    from: number
    to: number
    spans: readonly Span[]
    own: readonly Span[]
    minutes: readonly Minute[]
    now: number
    onday: (day: number) => void
  } = $props()

  const pieces = $derived(piecesIn(own, from, to, now))
  const totals = $derived(totalsOf(pieces))
  const whole = $derived(wholeOf(pieces))
  const active = $derived(minutes.reduce((sum, one) => sum + one.active * 1000, 0))
  const days = $derived.by(() => {
    const out: { day: number; totals: ReturnType<typeof totalsOf>; whole: number }[] = []
    for (let day = from; day < to; day = daysAfter(day, 1)) {
      const inDay = piecesIn(own, day, daysAfter(day, 1), now)
      out.push({ day, totals: totalsOf(inDay), whole: wholeOf(inDay) })
    }
    return out
  })
  const passed = $derived(Math.max(1, days.filter((one) => one.whole > 0).length))
  const longest = $derived(
    days.map((one) => one.whole).reduce((high, one) => Math.max(high, one), 1),
  )
  const seen = $derived(piecesIn(spans, from, to, now))
  const groups = $derived(
    (
      [
        ['app', t('Apps')],
        ['site', t('Websites')],
        ['space', t('Spaces')],
      ] as const
    )
      .map(([lane, label]) => ({ lane, label, list: placesOf(seen, lane).slice(0, 8) }))
      .filter((one) => one.list.length),
  )
  const most = (list: readonly Place[]) =>
    list.map((one) => one.ms).reduce((high, one) => Math.max(high, one), 1)

  const madeOfText = (activity: string | null): string =>
    (['site', 'app'] as const)
      .flatMap((lane) => madeOf(spans, activity, lane, from, to, now).slice(0, 2))
      .sort((one, other) => other.ms - one.ms)
      .slice(0, 3)
      .map((one) => `${one.name} ${length(one.ms)}`)
      .join(' · ')

  function placeMenu(event: MouseEvent, lane: Lane, place: Place) {
    event.preventDefault()
    const was = time.ruleFor(lane, place.key)?.activity ?? null
    menu.show(
      event,
      [
        ...time.activities
          .filter((one) => !one.archived || one.id === was)
          .map((one) => ({
            label: one.name,
            checked: one.id === was,
            run: () => time.countAs(lane, place.key, one.id),
          })),
        null,
        {
          label: t('No activity'),
          checked: was === null,
          run: () => time.countAs(lane, place.key, null),
        },
      ],
      { title: `${t('Count as')}: ${place.name}` },
    )
  }

  async function askGoal(activity: Activity, per: Per) {
    const was = time.goalFor(activity.id, per)
    const said = await prompt.ask({
      title: per === 'day' ? t('Daily goal') : t('Weekly goal'),
      value: was ? lasting(was.ms) : '',
      placeholder: '1:30',
      confirmLabel: t('Save'),
    })
    if (said !== null) time.setGoal(activity.id, per, lengthIn(said))
  }

  function activityMenu(event: MouseEvent, activity: Activity | null) {
    event.preventDefault()
    if (!activity) return
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
        ...(['day', 'week'] as const).map((per) => ({
          label: per === 'day' ? t('Daily goal') : t('Weekly goal'),
          checked: time.goalFor(activity.id, per) !== null,
          run: () => void askGoal(activity, per),
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

<div class="reports">
  <div class="cards">
    <div class="card">
      <span class="what">{t('You said')}</span>
      <span class="much">{length(whole)}</span>
    </div>
    <div class="card">
      <span class="what">{t('Active')}</span>
      <span class="much">{length(active)}</span>
    </div>
    <div class="card">
      <span class="what">{t('Daily average')}</span>
      <span class="much">{length(whole / passed)}</span>
    </div>
  </div>

  <div class="chart" role="img" aria-label={t('You said')}>
    {#each days as one (one.day)}
      <button type="button" class="column" title={length(one.whole)} onclick={() => onday(one.day)}>
        <span class="stack" style:height="{(one.whole / longest) * 100}%">
          {#each one.totals as total (total.activity)}
            <span style:flex-grow={total.ms} style:background={tintOf(total.activity)}></span>
          {/each}
        </span>
        <span class="day"
          >{i18n.when(one.day, days.length > 7 ? { day: 'numeric' } : { weekday: 'short' })}</span
        >
      </button>
    {/each}
  </div>

  <section class="activities">
    <p class="orden-section">{t('Activity')}</p>
    {#if !totals.length}
      <p class="none">{t('Nothing recorded yet.')}</p>
    {/if}
    <ul>
      {#each totals as total (total.activity)}
        {@const activity = time.activity(total.activity)}
        {@const goal = activity && days.length === 7 ? time.goalFor(activity.id, 'week') : null}
        {@const made = madeOfText(total.activity)}
        <li>
          <button
            type="button"
            class="orden-row"
            oncontextmenu={(event) => activityMenu(event, activity)}
            onclick={(event) => activityMenu(event, activity)}
          >
            <span class="dot" style:background={tintOf(total.activity)}></span>
            <span class="orden-row-label">
              <span class="name" dir="auto">{nameOf(total.activity, t('No activity'))}</span>
              {#if made}<span class="made">{made}</span>{/if}
            </span>
            <span class="bar"
              ><span
                style:width="{(total.ms / (goal?.ms ?? whole)) * 100}%"
                style:--tint={tintOf(total.activity)}
              ></span></span
            >
            <span class="orden-row-meta"
              >{length(total.ms)}{goal ? ` / ${length(goal.ms)}` : ''}</span
            >
          </button>
        </li>
      {/each}
    </ul>
  </section>
  <div class="columns">
    {#each groups as group (group.lane)}
      <section>
        <p class="orden-section">{group.label}</p>
        <ul>
          {#each group.list as place (place.key)}
            {@const rule = time.ruleFor(group.lane, place.key)}
            <li>
              <button
                type="button"
                class="orden-row is-short"
                aria-haspopup="menu"
                title={t('Count as')}
                onclick={(event) => placeMenu(event, group.lane, place)}
                oncontextmenu={(event) => placeMenu(event, group.lane, place)}
              >
                <span class="dot" style:background={placeTint(place.key)}></span>
                <span class="orden-row-label" dir="auto">{place.name}</span>
                {#if rule}<span class="counted" style:color={tintOf(rule.activity)}
                    >{nameOf(rule.activity, '')}</span
                  >{/if}
                <span class="bar"
                  ><span
                    style:width="{(place.ms / most(group.list)) * 100}%"
                    style:--tint={placeTint(place.key)}
                  ></span></span
                >
                <span class="orden-row-meta">{length(place.ms)}</span>
              </button>
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>
</div>

<style>
  .reports {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
    gap: var(--space-2);
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-3);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  .what {
    color: var(--muted);
    font-size: var(--text-xs);
  }

  .much {
    color: var(--text-strong);
    font-size: 1.35rem;
    font-variant-numeric: tabular-nums;
    font-weight: var(--weight-strong);
  }

  .chart {
    display: flex;
    align-items: stretch;
    gap: 4px;
    height: 9rem;
  }

  .column {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    justify-content: flex-end;
    align-items: stretch;
    gap: 4px;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    font-size: var(--text-xs);
    cursor: pointer;
  }

  .stack {
    display: flex;
    flex-direction: column-reverse;
    min-height: 2px;
    overflow: hidden;
    border-radius: 3px 3px 0 0;
    background: var(--surface-2);
  }

  .stack span {
    flex-basis: 0;
  }

  .day {
    text-align: center;
    white-space: nowrap;
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr));
    gap: var(--space-4);
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
  }

  .name {
    display: block;
    overflow: hidden;
    text-align: -webkit-match-parent;
    text-align: match-parent;
    text-overflow: ellipsis;
  }

  .made {
    display: block;
    overflow: hidden;
    color: var(--muted);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .activities .bar {
    flex-basis: 40%;
  }

  .bar {
    flex: 0 0 22%;
    height: 6px;
    overflow: hidden;
    border-radius: 3px;
    background: var(--surface-2);
  }

  .bar span {
    display: block;
    max-width: 100%;
    height: 100%;
    background: var(--tint);
  }

  @media (forced-colors: active) {
    .bar span {
      background: Highlight;
    }
  }

  .counted {
    flex: none;
    font-size: var(--text-xs);
  }

  .none {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }
</style>

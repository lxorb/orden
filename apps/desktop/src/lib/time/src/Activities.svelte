<script lang="ts">
  import { tick } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../platform/src/api'
  import { iconChoosing } from '@orden/contracts'
  import { accentColour, accentIdFor, ACCENTS, theme } from '../../theme/src/api'
  import { Sheet, Swatches } from '../../ui-controls/src/api'
  import { DIVIDER, dropOver, hang, menu, overlays, prompt, Twist } from '../../ui-kit/src/api'
  import ActivityMark from './ActivityMark.svelte'
  import { lasting } from './days'
  import { lengthIn } from './goals'
  import { length, tintOf } from './look'
  import type { Activity, Per } from './records'
  import { time } from './time.svelte'

  const { open, onclose }: { open: boolean; onclose: () => void } = $props()
  let named = $state('')
  let adder = $state<HTMLInputElement | null>(null)
  let showArchived = $state(false)
  let dragging = $state<string | null>(null)
  let dropAt = $state<number | null>(null)
  let colouring = $state<{ id: string; from: HTMLElement } | null>(null)
  let swatchLayer = $state<HTMLElement | null>(null)
  const live = $derived(time.activities.filter((one) => !one.archived))
  const archived = $derived(time.activities.filter((one) => one.archived))
  const swatches = $derived(
    ACCENTS.map((one) => ({ value: one.id, label: one.name, colour: accentColour(one.id, theme.current) })),
  )
  $effect(() => {
    if (open) void tick().then(() => adder?.focus())
  })
  $effect(() =>
    colouring
      ? overlays.show(
          () => (colouring = null),
          () => [swatchLayer, colouring?.from ?? null],
        )
      : undefined,
  )
  function added() {
    const name = named.trim()
    if (!name) return
    const same = time.activities.find((one) => one.name.toLocaleLowerCase() === name.toLocaleLowerCase())
    if (same?.archived) time.changeActivity(same.id, { archived: false })
    else if (!same) time.addActivity(name, accentIdFor(name))
    named = ''
  }
  function renamed(activity: Activity, field: HTMLInputElement) {
    if (field.value.trim()) time.changeActivity(activity.id, { name: field.value })
    else field.value = activity.name
  }
  async function askGoal(activity: Activity, per: Per) {
    const was = time.goalFor(activity.id, per)
    const said = await prompt.ask({
      title: per === 'day' ? 'Daily goal' : 'Weekly goal',
      value: was ? lasting(was.ms) : '',
      placeholder: '1:30',
      confirmLabel: 'Save',
    })
    if (said !== null) time.setGoal(activity.id, per, lengthIn(said))
  }
  function move(activity: Activity, by: number) {
    const at = live.findIndex((one) => one.id === activity.id)
    if (at >= 0) time.moveActivity(activity.id, at + by)
  }
  function more(event: MouseEvent, activity: Activity) {
    event.preventDefault()
    const goal = (per: Per) => time.goalFor(activity.id, per)
    const at = live.findIndex((one) => one.id === activity.id)
    menu.show(
      event,
      [
        ...(activity.archived
          ? []
          : [
              ...(['day', 'week'] as const).map((per) => ({
                label: per === 'day' ? 'Daily goal' : 'Weekly goal',
                checked: goal(per) !== null,
                run: () => void askGoal(activity, per),
              })),
              DIVIDER,
              ...(at > 0 ? [{ label: 'Move up', run: () => move(activity, -1) }] : []),
              ...(at < live.length - 1 ? [{ label: 'Move down', run: () => move(activity, 1) }] : []),
              DIVIDER,
            ]),
        {
          label: activity.archived ? 'Unarchive' : 'Archive',
          run: () => time.changeActivity(activity.id, { archived: !activity.archived }),
        },
        { label: 'Delete', danger: true, run: () => time.removeActivity(activity.id) },
      ],
      { title: activity.name },
    )
  }
  const goalsOf = (activity: Activity): string => {
    const day = time.goalFor(activity.id, 'day')
    const week = time.goalFor(activity.id, 'week')
    return [day ? `${length(day.ms)} a day` : '', week ? `${length(week.ms)} a week` : ''].filter(Boolean).join(', ')
  }
  function keyed(event: KeyboardEvent, activity: Activity) {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    move(activity, event.key === 'ArrowUp' ? -1 : 1)
    const target = event.currentTarget
    void tick().then(() => (target as HTMLElement | null)?.focus())
  }
  function taken(event: DragEvent, id: string) {
    event.dataTransfer?.setData('text/plain', id)
    dragging = id
  }
  function over(event: DragEvent, at: number) {
    if (dragging === null) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropAt = at
  }
  function dropped(event: DragEvent, at: number) {
    event.preventDefault()
    if (dragging !== null) time.moveActivity(dragging, at)
    dragging = null
    dropAt = null
  }
  function colour(event: MouseEvent, id: string) {
    const from = event.currentTarget as HTMLElement
    colouring = colouring?.id === id ? null : { id, from }
  }
</script>

{#snippet row(activity: Activity, at: number)}
  <li
    class="orden-row entry"
    class:gone={activity.archived}
    class:landing={dropAt === at && dragging !== activity.id}
    class:carried={dragging === activity.id}
    style:--tint={tintOf(activity.id)}
    data-activity={activity.id}
    draggable={!activity.archived}
    ondragstart={(event) => taken(event, activity.id)}
    use:dropOver={(event) => over(event, at)}
    ondragleave={() => (dropAt = null)}
    ondragend={() => {
      dragging = null
      dropAt = null
    }}
    ondrop={(event) => dropped(event, at)}
    oncontextmenu={(event) => more(event, activity)}
  >
    {#if !activity.archived}
      <span class="grip" aria-hidden="true"
        ><svg viewBox="0 0 8 14"
          ><circle cx="2" cy="3" r="1" /><circle cx="6" cy="3" r="1" /><circle cx="2" cy="7" r="1" /><circle
            cx="6"
            cy="7"
            r="1"
          /><circle cx="2" cy="11" r="1" /><circle cx="6" cy="11" r="1" /></svg
        ></span
      >
    {/if}
    <button
      type="button"
      class="tile"
      aria-label="Icon"
      title="Icon"
      data-activity-icon
      disabled={iconChoosing() === null}
      onclick={() => iconChoosing()?.pass(activity.icon, (icon) => time.changeActivity(activity.id, { icon }))}
    >
      <ActivityMark activity={activity.id} size={16} />
    </button>
    <input
      class="orden-title-field naming"
      aria-label="Name"
      value={activity.name}
      onchange={(event) => renamed(activity, event.currentTarget)}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
        else keyed(event, activity)
      }}
    />
    {#if goalsOf(activity)}<span class="orden-row-meta goals">{goalsOf(activity)}</span>{/if}
    {#if activity.archived}
      <button type="button" class="orden-chip" onclick={() => time.changeActivity(activity.id, { archived: false })}
        >Unarchive</button
      >
    {:else}
      <button
        type="button"
        class="dot"
        aria-label="Colour"
        title="Colour"
        aria-haspopup="dialog"
        aria-expanded={colouring?.id === activity.id}
        data-activity-colour
        onclick={(event) => colour(event, activity.id)}
      ></button>
    {/if}
    <button
      type="button"
      class="orden-glyph"
      aria-label="More"
      title="More"
      aria-haspopup="menu"
      onclick={(event) => more(event, activity)}>⋯</button
    >
  </li>
{/snippet}

<Sheet {open} title="Activities" width="34rem" {onclose}>
  <form
    onsubmit={(event) => {
      event.preventDefault()
      added()
    }}
  >
    <label class="orden-field">
      <svg class="orden-field-mark" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.5v9M3.5 8h9" /></svg>
      <input
        bind:this={adder}
        bind:value={named}
        aria-label="New activity"
        placeholder="Add an activity"
        data-activity-add
      />
    </label>
  </form>
  {#if live.length}
    <ul class="list" data-time-sheet>
      {#each live as activity, at (activity.id)}
        {@render row(activity, at)}
      {/each}
    </ul>
  {:else}
    <p class="empty">No activities yet. Add one above, or start one from the timer.</p>
  {/if}
  {#if archived.length}
    <button
      type="button"
      class="orden-row is-short fold"
      aria-expanded={showArchived}
      data-activity-archived
      onclick={() => (showArchived = !showArchived)}
    >
      <span class="twist"><Twist open={showArchived} /></span>
      <span class="orden-row-label">Archived</span>
      <span class="orden-row-meta">{archived.length}</span>
    </button>
    {#if showArchived}
      <ul class="list">
        {#each archived as activity, at (activity.id)}
          {@render row(activity, live.length + at)}
        {/each}
      </ul>
    {/if}
  {/if}
</Sheet>

{#if colouring}
  {@const chosen = time.activity(colouring.id)}
  <div
    class="swatch-layer orden-layer"
    data-covers
    bind:this={swatchLayer}
    use:hang={{ side: 'below', gap: 6, from: colouring.from }}
    transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}
  >
    <Swatches
      options={swatches}
      label="Colour"
      chosen={chosen?.tint ?? ''}
      onchoose={(tint: string) => {
        if (colouring) time.changeActivity(colouring.id, { tint })
        colouring = null
      }}
    />
  </div>
{/if}

<style>
  .list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .entry {
    position: relative;
    gap: var(--space-2);
    min-height: calc(var(--row-height) + var(--space-2));
    padding: 0 var(--space-1) 0 var(--space-2);
  }
  @media (hover: hover) {
    .entry:hover .grip {
      opacity: 1;
    }
  }
  .entry.landing::before {
    content: '';
    position: absolute;
    inset: -2px var(--space-1) auto;
    height: 2px;
    border-radius: 1px;
    background: var(--accent);
  }
  .carried {
    opacity: 0.5;
  }
  .grip {
    flex: none;
    display: grid;
    place-items: center;
    width: 10px;
    margin-inline-start: calc(-1 * var(--space-1));
    color: var(--muted);
    opacity: 0;
    cursor: grab;
    transition: opacity var(--dur-fast) var(--ease-out);
  }
  .grip svg {
    width: 8px;
    height: 14px;
    fill: currentColor;
  }
  :global([data-touch]) .grip {
    opacity: 1;
  }
  .tile {
    flex: none;
    display: grid;
    place-items: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-md);
    background: color-mix(in srgb, var(--tint) 16%, transparent);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .tile:hover {
      background: color-mix(in srgb, var(--tint) 28%, transparent);
    }
  }
  .naming {
    flex: 1;
    min-width: 0;
    font-weight: var(--weight-row);
  }
  .gone .naming {
    color: var(--muted);
  }
  .gone .tile {
    filter: grayscale(1);
    opacity: 0.6;
  }
  .goals {
    flex: none;
    font-size: var(--text-xs);
  }
  .dot {
    flex: none;
    width: 18px;
    height: 18px;
    margin: 0 var(--space-1);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--tint);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent);
    cursor: default;
    transition: transform var(--dur-fast) var(--ease-out);
  }
  @media (hover: hover) {
    .dot:hover {
      transform: scale(1.12);
    }
  }
  .dot[aria-expanded='true'] {
    box-shadow:
      0 0 0 2px var(--surface),
      0 0 0 4px var(--tint);
  }
  .empty {
    margin: var(--space-4) 0;
    color: var(--muted);
    text-align: center;
  }
  .fold {
    margin-top: var(--space-3);
  }
  .twist {
    flex: none;
    width: 10px;
    height: 10px;
    color: var(--muted);
  }
  .swatch-layer {
    z-index: var(--z-menu);
    width: max-content;
    padding: var(--space-3);
  }
</style>

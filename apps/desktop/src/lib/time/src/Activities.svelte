<script lang="ts">
  import { iconChoice } from '../../icon-picker/src/api'
  import { ACCENTS } from '../../theme/src/api'
  import { Select, Sheet } from '../../ui-controls/src/api'
  import { DIVIDER, menu, prompt } from '../../ui-kit/src/api'
  import ActivityMark from './ActivityMark.svelte'
  import { lasting } from './days'
  import { lengthIn } from './goals'
  import { length } from './look'
  import type { Activity, Per } from './records'
  import { time } from './time.svelte'

  const { open, onclose }: { open: boolean; onclose: () => void } = $props()
  let named = $state('')
  const live = $derived(time.activities.filter((one) => !one.archived))
  const archived = $derived(time.activities.filter((one) => one.archived))
  const TINTS = ACCENTS.map((one) => ({ value: one.id, label: one.name }))
  function added() {
    if (!named.trim()) return
    time.addActivity(named)
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
  function more(event: MouseEvent, activity: Activity) {
    event.preventDefault()
    const goal = (per: Per) => time.goalFor(activity.id, per)
    menu.show(
      event,
      [
        ...(['day', 'week'] as const).map((per) => ({
          label: per === 'day' ? 'Daily goal' : 'Weekly goal',
          checked: goal(per) !== null,
          run: () => void askGoal(activity, per),
        })),
        DIVIDER,
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
</script>

{#snippet row(activity: Activity)}
  <li
    class="orden-row line"
    class:gone={activity.archived}
    data-activity={activity.id}
    oncontextmenu={(event) => more(event, activity)}
  >
    <button
      type="button"
      class="orden-glyph icon"
      aria-label="Icon"
      title="Icon"
      onclick={() => iconChoice.pass(activity.icon, (icon) => time.changeActivity(activity.id, { icon }))}
    >
      <ActivityMark activity={activity.id} size={18} />
    </button>
    <input
      class="orden-title-field name"
      aria-label="Name"
      value={activity.name}
      onchange={(event) => renamed(activity, event.currentTarget)}
      onkeydown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
    {#if goalsOf(activity)}<span class="orden-row-meta goals">{goalsOf(activity)}</span>{/if}
    <div class="tint">
      <Select
        plain
        label="Colour"
        value={activity.tint ?? ''}
        options={TINTS}
        onchange={(tint: string) => time.changeActivity(activity.id, { tint })}
      />
    </div>
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

<Sheet {open} title="Activities" {onclose}>
  <ul class="list" data-time-sheet>
    {#each live as activity (activity.id)}
      {@render row(activity)}
    {/each}
    <li class="orden-row line add">
      <span class="orden-glyph icon" aria-hidden="true">+</span>
      <input
        class="orden-title-field name"
        aria-label="New activity"
        placeholder="New activity"
        bind:value={named}
        onkeydown={(event) => {
          if (event.key === 'Enter') added()
        }}
        onblur={added}
      />
    </li>
  </ul>
  {#if archived.length}
    <p class="orden-section">Archived</p>
    <ul class="list">
      {#each archived as activity (activity.id)}
        {@render row(activity)}
      {/each}
    </ul>
  {/if}
</Sheet>

<style>
  .list {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .line {
    gap: var(--space-1);
    padding-inline: var(--space-1);
  }
  .icon {
    flex: none;
  }
  .name {
    flex: 1;
  }
  .gone .name {
    color: var(--muted);
  }
  .goals {
    flex: none;
    font-size: var(--text-xs);
  }
  .tint {
    flex: none;
    width: 7rem;
  }
  .add .icon {
    color: var(--muted);
  }
  .add .name::placeholder {
    color: var(--muted);
  }
</style>

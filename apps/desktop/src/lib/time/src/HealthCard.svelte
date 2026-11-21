<script lang="ts">
  import { healthSum, type Reading, type Workout } from './health'
  import { clock, length } from './look'

  const {
    from,
    to,
    readings,
    workouts,
  }: { from: number; to: number; readings: readonly Reading[]; workouts: readonly Workout[] } = $props()
  const sum = $derived(healthSum(readings, workouts, from, to))
  const round = (value: number) => String(Math.round(value))
  const rows = $derived(
    [
      sum.heart
        ? ['Heart rate', `${round(sum.heart.mean)} bpm`, `${round(sum.heart.low)} to ${round(sum.heart.high)}`]
        : null,
      sum.steps ? ['Steps', Math.round(sum.steps).toLocaleString(), ''] : null,
      sum.sleep
        ? ['Sleep', length(sum.sleep.total), `deep ${length(sum.sleep.deep)}, REM ${length(sum.sleep.rem)}`]
        : null,
      sum.stress === null ? null : ['Stress', round(sum.stress), 'of 100'],
      sum.spo2 ? ['Blood oxygen', `${round(sum.spo2.mean)}%`, `low ${round(sum.spo2.low)}%`] : null,
      sum.breath === null ? null : ['Breathing', `${round(sum.breath)}/min`, ''],
    ].filter((one): one is string[] => one !== null),
  )
</script>

{#if rows.length || sum.workouts.length}
  <section class="card health" data-time-health-card>
    <p class="orden-section">Health</p>
    <ul>
      {#each rows as [name, value, more] (name)}
        <li class="orden-row is-short" data-health-row={name}>
          <span class="orden-row-label">{name}</span>
          {#if more}<span class="orden-row-meta more">{more}</span>{/if}
          <span class="orden-row-meta value">{value}</span>
        </li>
      {/each}
    </ul>
    {#if sum.workouts.length}
      <p class="orden-section later">Workouts</p>
      <ul>
        {#each sum.workouts as workout (workout.id)}
          <li class="orden-row is-short" data-health-workout>
            <span class="orden-row-label">{workout.sport}</span>
            <span class="orden-row-meta more"
              >{clock(workout.start)}{workout.heart ? `, ${round(workout.heart)} bpm` : ''}</span
            >
            <span class="orden-row-meta value">{length(workout.end - workout.start)}</span>
          </li>
        {/each}
      </ul>
    {/if}
  </section>
{/if}

<style>
  .card {
    min-width: 0;
    padding: var(--space-4) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-lg);
    background: var(--surface);
    box-shadow: var(--shadow-sm);
  }
  .orden-section {
    margin: 0 0 var(--space-1);
    padding: 0 var(--row-pad);
  }
  .later {
    margin-top: var(--space-3);
  }
  ul {
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .orden-row-meta {
    font-variant-numeric: tabular-nums;
  }
  .value {
    flex: 0 0 4.75rem;
    text-align: end;
  }
  .more {
    color: var(--muted);
  }
</style>

<script lang="ts">
  import { t } from '../i18n.svelte'
  import { atClock, clockOf, dayOf, daysAfter } from './days'
  import type { Span } from './records'
  import { time } from './time.svelte'

  const { span, ondone }: { span: Span; ondone: () => void } = $props()

  const day = $derived(dayOf(span.start))

  function moved(which: 'start' | 'end', clock: string) {
    const at = atClock(day, clock)
    if (at === null) return
    if (which === 'start') time.changeSpan(span.id, { start: at })
    else time.changeSpan(span.id, { end: at < span.start ? atClock(daysAfter(day, 1), clock) : at })
  }

  const tagsIn = (text: string) =>
    text
      .split(',')
      .map((one) => one.trim())
      .filter(Boolean)
</script>

<div class="editor">
  <select
    class="nib-field"
    aria-label={t('Activity')}
    value={span.activity ?? ''}
    onchange={(event) => time.changeSpan(span.id, { activity: event.currentTarget.value || null })}
  >
    <option value="">{t('No activity')}</option>
    {#each time.activities.filter((one) => !one.archived || one.id === span.activity) as one (one.id)}
      <option value={one.id}>{one.name}</option>
    {/each}
  </select>
  <div class="clocks">
    <input
      class="nib-field"
      type="time"
      aria-label={t('Start time')}
      value={clockOf(span.start)}
      onchange={(event) => moved('start', event.currentTarget.value)}
    />
    <input
      class="nib-field"
      type="time"
      aria-label={t('End time')}
      value={span.end === null ? '' : clockOf(span.end)}
      onchange={(event) => moved('end', event.currentTarget.value)}
    />
  </div>
  <input
    class="nib-field"
    aria-label={t('Tags')}
    placeholder={t('Tags')}
    value={span.tags.join(', ')}
    onchange={(event) => time.changeSpan(span.id, { tags: tagsIn(event.currentTarget.value) })}
  />
  <input
    class="nib-field"
    aria-label={t('Note')}
    placeholder={t('Note')}
    value={span.note}
    onchange={(event) => time.changeSpan(span.id, { note: event.currentTarget.value })}
  />
  <div class="actions">
    <button
      type="button"
      class="nib-chip"
      onclick={() => {
        time.removeSpan(span.id)
        ondone()
      }}>{t('Delete')}</button
    >
    <button type="button" class="nib-chip" onclick={ondone}>{t('Done')}</button>
  </div>
</div>

<style>
  .editor {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-2) 0 var(--space-3);
  }

  .clocks {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>

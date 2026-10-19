<script lang="ts">
  /** What can be done to every task selected at once, Todoist's bulk bar in nib's
   *  floating bar (`.nib-bar`): how many, the day, the project, the labels, the
   *  priority, and the rest in ⋯ (task-actions.ts). Each is one write of all of them,
   *  so one undo takes it back. It stands at the foot of the list while the list is on
   *  screen. */
  import type { Row } from '@nib/bases'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import Ellipsis from 'lucide/dist/esm/icons/ellipsis.mjs'
  import Flag from 'lucide/dist/esm/icons/flag.mjs'
  import Folder from 'lucide/dist/esm/icons/folder-input.mjs'
  import Tag from 'lucide/dist/esm/icons/tag.mjs'
  import X from 'lucide/dist/esm/icons/x.mjs'
  import { amount, t } from '../i18n.svelte'
  import { menu } from '../menu.svelte'
  import { shortcuts } from '../shortcuts.svelte'
  import Glyph from '../quick-add/Glyph.svelte'
  import type { Kit } from './kit'
  import type { Box } from './schedule/scheduling.svelte'
  import {
    labelEntries,
    moveEntries,
    prioritise,
    priorityEntries,
    scheduleRows,
    taskMenu,
  } from './task-actions'

  const { rows, kit, onclear }: { rows: readonly Row[]; kit: Kit; onclear: () => void } = $props()

  /** The box a button is, for what opens over it. */
  const boxOf = (event: MouseEvent): Box =>
    event.currentTarget instanceof Element
      ? event.currentTarget.getBoundingClientRect()
      : { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY }
</script>

<div class="holder">
  <div
    class="nib-bar bar"
    role="toolbar"
    aria-label={t('{count} selected', { count: amount(rows.length) })}
  >
    <span class="count">{t('{count} selected', { count: amount(rows.length) })}</span>
    <button
      type="button"
      title={shortcuts.tooltip(t('Schedule'), 'tasks.schedule')}
      aria-label={t('Schedule')}
      onclick={(event) => scheduleRows(rows, boxOf(event), kit, onclear)}
      ><Glyph icon={Calendar} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip(t('Move to'), 'tasks.move')}
      aria-label={t('Move to')}
      onclick={(event) => menu.show(event, moveEntries(rows))}><Glyph icon={Folder} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip(t('Labels'), 'tasks.labels')}
      aria-label={t('Labels')}
      onclick={(event) => menu.show(event, labelEntries(rows))}><Glyph icon={Tag} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip(t('Priority'), 'tasks.priority')}
      aria-label={t('Priority')}
      onclick={(event) =>
        menu.show(
          event,
          priorityEntries(0, (priority) => void prioritise(rows, priority)),
        )}><Glyph icon={Flag} /></button
    >
    <button
      type="button"
      title={shortcuts.tooltip(t('More'), 'tasks.more')}
      aria-label={t('More')}
      onclick={(event) => taskMenu(event, rows, kit)}><Glyph icon={Ellipsis} /></button
    >
    <button type="button" title={t('Cancel')} aria-label={t('Cancel')} onclick={onclear}
      ><Glyph icon={X} /></button
    >
  </div>
</div>

<style>
  /* No room of its own in the list: a line at the foot of what is on screen, the bar
     standing on it. */
  .holder {
    position: sticky;
    bottom: 0;
    z-index: var(--z-raised);
    height: 0;
  }

  .bar {
    position: absolute;
    bottom: var(--space-4);
    left: 50%;
    align-items: center;
    translate: -50% 0;
    animation: rise var(--dur-fast) var(--ease-out);
  }

  @keyframes rise {
    from {
      opacity: 0;
      translate: -50% 6px;
    }
  }

  .count {
    padding-inline: var(--space-2) var(--space-1);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .bar button {
    display: grid;
    place-items: center;
  }
</style>

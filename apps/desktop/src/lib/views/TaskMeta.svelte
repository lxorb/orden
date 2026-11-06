<script lang="ts">
  import type { Row } from '@orden/bases'
  import Bell from 'lucide/dist/esm/icons/bell.mjs'
  import Calendar from 'lucide/dist/esm/icons/calendar-days.mjs'
  import Hash from 'lucide/dist/esm/icons/hash.mjs'
  import Inbox from 'lucide/dist/esm/icons/inbox.mjs'
  import ListTree from 'lucide/dist/esm/icons/list-tree.mjs'
  import Message from 'lucide/dist/esm/icons/message-square.mjs'
  import Repeat from 'lucide/dist/esm/icons/repeat.mjs'
  import Tag from 'lucide/dist/esm/icons/tag.mjs'
  import Target from 'lucide/dist/esm/icons/target.mjs'
  import Timer from 'lucide/dist/esm/icons/timer.mjs'
  import User from 'lucide/dist/esm/icons/user.mjs'
  import { amount, t } from '../i18n.svelte'
  import Glyph from '../quick-add/Glyph.svelte'
  import { durationLabel } from '../quick-add/labels'
  import { theme } from '../theme.svelte'
  import { labelColour, type Meta, placeOf } from './task-meta'

  const {
    row,
    meta,
    where = true,
    elsewhere = null,
    onwhere,
  }: {
    row: Row
    meta: readonly Meta[]
    where?: boolean
    elsewhere?: string | null
    onwhere?: (event: MouseEvent) => void
  } = $props()

  const place = $derived(placeOf(row))

  const TONES = {
    late: 'var(--danger)',
    today: 'var(--success)',
    tomorrow: 'var(--canvas-2)',
    week: 'var(--canvas-6)',
    later: undefined,
  } as const
</script>

{#snippet placed()}
  <Glyph icon={place.inbox ? Inbox : Hash} />
  {#if elsewhere}<span class="space">{elsewhere}</span>{/if}
  <span class="name"
    >{place.inbox ? t('Inbox') : place.name}{#if place.section}<span class="sep" aria-hidden="true"
        >›</span
      >{place.section}{/if}</span
  >
{/snippet}

{#each meta as one, index (index)}
  {#if one.kind === 'date'}
    <span class="bit" style:color={TONES[one.tone]}
      ><Glyph
        icon={one.repeat && !one.text ? Repeat : Calendar}
      />{one.text}{#if one.repeat && one.text}<span class="repeat" aria-label={t('Repeat')}
          ><Glyph icon={Repeat} /></span
        >{/if}</span
    >
  {:else if one.kind === 'deadline'}
    <span class="bit" class:late={one.late} title={t('Deadline')}
      ><Glyph icon={Target} />{one.text}{#if one.repeat}<span
          class="repeat"
          aria-label={t('Repeat')}><Glyph icon={Repeat} /></span
        >{/if}</span
    >
  {:else if one.kind === 'duration'}
    <span class="bit"><Glyph icon={Timer} />{durationLabel(one.minutes)}</span>
  {:else if one.kind === 'remind'}
    <span class="bit" aria-label={t('Reminder')}><Glyph icon={Bell} /></span>
  {:else if one.kind === 'subtasks'}
    <span class="bit"><Glyph icon={ListTree} />{amount(one.done)}/{amount(one.total)}</span>
  {:else if one.kind === 'comments'}
    <span class="bit"><Glyph icon={Message} />{amount(one.count)}</span>
  {:else if one.kind === 'tag'}
    <span class="bit tag" style:color={labelColour(one.tag, theme.current)}
      ><Glyph icon={Tag} />{one.tag}</span
    >
  {:else}
    <span class="bit"><Glyph icon={User} />{one.name}</span>
  {/if}
{/each}
{#if where}
  {#if onwhere}
    <button type="button" class="where" onclick={onwhere} tabindex="-1" title={t('Open')}
      >{@render placed()}</button
    >
  {:else}
    <span class="where">{@render placed()}</span>
  {/if}
{/if}

<style>
  .bit {
    flex: none;
    display: inline-flex;
    align-items: center;
    gap: 3px;
  }

  .late {
    color: var(--danger);
  }

  .repeat {
    display: inline-flex;
    margin-inline-start: 1px;
  }

  .where {
    flex: 0 1 auto;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    min-width: 0;
    margin-inline-start: auto;
    overflow: hidden;
    padding: 0;
    border: none;
    background: none;
    color: var(--muted);
    font: inherit;
    white-space: nowrap;
    cursor: default;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (hover: hover) {
    button.where:hover {
      color: var(--text-strong);
    }
  }

  .sep {
    margin: 0 0.3em;
  }

  .space {
    flex: none;
    margin-inline-end: 0.2em;
    color: var(--muted-strong);
  }
</style>

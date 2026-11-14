<script lang="ts">
  import type { Member } from '@orden/chats'
  import type { Special } from './compose'
  import { cubicOut } from 'svelte/easing'
  import { dur, fly } from '../../motion'
  import { Avatar } from '../../accounts-ui/src/api'
  import { faceOf, nameOf } from './people'

  const {
    choices,
    lit,
    members,
    space,
    onpick,
  }: {
    choices: (Member | Special)[]
    lit: number
    members: readonly Member[]
    space: string | null
    onpick: (choice: Member | Special) => void
  } = $props()

  const rows = $derived(
    choices.map((choice) =>
      typeof choice === 'string'
        ? { key: choice, choice, member: null }
        : { key: choice.who, choice, member: choice },
    ),
  )
</script>

<div
  class="mentions orden-layer"
  role="listbox"
  aria-label="@"
  transition:fly={{ y: 4, duration: dur(130), easing: cubicOut }}
>
  {#each rows as row, index (row.key)}
    <button
      type="button"
      class="orden-row"
      class:is-on={index === lit}
      role="option"
      aria-selected={index === lit}
      onpointerdown={(event) => {
        event.preventDefault()
        onpick(row.choice)
      }}
    >
      {#if row.member}
        <span class="orden-row-mark"
          ><Avatar face={faceOf(row.member.who, members, space)} size={20} /></span
        >
        <span class="orden-row-label">{nameOf(row.member.who, members, space)}</span>
        {#if row.member.nick && row.member.nick !== row.member.name}
          <span class="orden-row-meta">{row.member.name}</span>
        {/if}
      {:else if row.key === 'orden'}
        <span class="orden-row-mark at">✦</span>
        <span class="orden-row-label">@{row.key}</span>
      {:else}
        <span class="orden-row-mark at">@</span>
        <span class="orden-row-label">@{row.key}</span>
      {/if}
    </button>
  {/each}
</div>

<style>
  .mentions {
    position: absolute;
    left: var(--space-3);
    bottom: calc(100% + 4px);
    z-index: var(--z-popover);
    width: min(280px, calc(100% - 2 * var(--space-3)));
    padding: var(--space-1);
  }

  .at {
    color: var(--muted);
    font-weight: var(--weight-strong);
  }
</style>

<script lang="ts">
  /** A column's head, Notion's: the group's name as a pill in its option's tone (a value
   *  no option holds is a quiet pill with no tone), the count, which is a button for the
   *  column's calculation, then ⋯ and + while the head is pointed at, and always under a
   *  thumb. The right button is the ⋯.
   *
   *  A board of tasks heads its columns as GitHub's project board does (#1046): a
   *  status circle in the group's tone, the name, the count in a badge, and a line
   *  under them that says what the column is, where it says anything. */
  import { t } from '../i18n.svelte'
  import { ADD_MARK } from './marks'

  const {
    name,
    tone,
    count,
    sums = [],
    muted = false,
    circle = false,
    about,
    carries = false,
    canAdd = true,
    onmenu,
    oncount,
    onadd,
  }: {
    name: string
    tone: string | null
    count: number
    /** The column's calculations, as they read: `21`, `Oct 9`. */
    sums?: readonly string[]
    /** A value no option holds. */
    muted?: boolean
    /** Headed with a status circle rather than a pill: a board of tasks. */
    circle?: boolean
    /** One line under the head, saying what the column holds. */
    about?: string | undefined
    /** Carried by its head to reorder the columns. */
    carries?: boolean
    canAdd?: boolean
    onmenu: (event: MouseEvent) => void
    oncount: (event: MouseEvent) => void
    onadd: () => void
  } = $props()
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="head" class:carries class:circled={circle} oncontextmenu={onmenu}>
  {#if circle}
    <span class="circle" style:--pill={tone} aria-hidden="true"></span>
    <span class="name plain">{name}</span>
  {:else}
    <span class="tag" class:toned={tone !== null} class:muted style:--pill={tone}>
      <span class="name">{name}</span>
    </span>
  {/if}
  <button
    type="button"
    class="count"
    class:badge={circle}
    aria-label={t('Calculate')}
    title={t('Calculate')}
    onclick={oncount}
    >{count}{#each sums as sum, at (at)}<span class="sum"> · {sum}</span>{/each}</button
  >
  <span class="spring"></span>
  <button
    type="button"
    class="nib-glyph tool"
    aria-label={t('More')}
    title={t('More')}
    onclick={onmenu}
  >
    <svg viewBox="0 0 13 13" aria-hidden="true" class="dots"
      ><circle cx="3" cy="6.5" r="0.9" /><circle cx="6.5" cy="6.5" r="0.9" /><circle
        cx="10"
        cy="6.5"
        r="0.9"
      /></svg
    >
  </button>
  {#if canAdd}
    <button
      type="button"
      class="nib-glyph tool"
      aria-label={t('New page')}
      title={t('New page')}
      onclick={onadd}
    >
      <svg viewBox="0 0 13 13" aria-hidden="true" class="plus"><path d={ADD_MARK} /></svg>
    </button>
  {/if}
</div>
{#if about}<p class="about">{about}</p>{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    height: var(--row-height);
    padding: 0 var(--space-2) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .head.carries {
    cursor: grab;
  }

  .tag {
    display: inline-flex;
    align-items: center;
    min-width: 0;
    max-width: 70%;
    padding: 1px var(--space-2);
    border-radius: var(--radius-sm);
    background: var(--surface-3);
    color: var(--text-strong);
    font-weight: var(--weight-strong);
  }

  /* An option's tone, as a card's pill wears it, deep enough to read in light and dark. */
  .tag.toned {
    background: color-mix(in srgb, var(--pill) 22%, transparent);
    color: color-mix(in srgb, var(--pill) 62%, var(--text-strong));
  }

  .tag.muted {
    background: none;
    box-shadow: inset 0 0 0 1px var(--line-strong);
    color: var(--muted-strong);
    font-weight: var(--weight-row);
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* GitHub's status circle: a ring in the group's tone round a dot of it. */
  .circle {
    flex: none;
    box-sizing: border-box;
    width: 12px;
    height: 12px;
    border: 2px solid var(--pill, var(--muted));
    border-radius: 50%;
    background: color-mix(in srgb, var(--pill, var(--muted)) 30%, transparent);
  }

  .plain {
    min-width: 0;
    overflow: hidden;
    color: var(--text-strong);
    font-weight: var(--weight-strong);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .head.circled {
    gap: var(--space-2);
  }

  .count.badge {
    height: 18px;
    padding: 0 6px;
    border-radius: 9px;
    background: var(--surface-3);
    color: var(--muted-strong);
    font-size: var(--text-xs);
  }

  .about {
    margin: 0;
    padding: 0 var(--space-3) var(--space-1);
    overflow: hidden;
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count {
    flex: none;
    padding: 0 var(--space-1);
    height: var(--row-height-sm);
    border: none;
    border-radius: var(--radius-row);
    background: none;
    color: var(--muted);
    font: inherit;
    font-variant-numeric: tabular-nums;
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  .sum {
    white-space: nowrap;
  }

  @media (hover: hover) {
    .count:hover {
      background: var(--surface-hover);
    }
  }

  .spring {
    flex: 1;
  }

  .tool {
    opacity: 0;
    transition: opacity var(--dur-fast) var(--ease-out);
  }

  .head:hover .tool,
  .head:focus-within .tool,
  :global([data-touch]) .tool {
    opacity: 1;
  }

  .dots {
    width: var(--icon-md);
    height: var(--icon-md);
    fill: currentColor;
  }

  .plus {
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.4;
    stroke-linecap: round;
  }
</style>

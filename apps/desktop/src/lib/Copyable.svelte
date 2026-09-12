<script lang="ts">
  /** A value beside the button that copies it.
   *
   *  An address, a command, a share link: the same row wherever one appears, so
   *  it is one component rather than a copy per panel. `plain` is for a value
   *  that is a word rather than something to be taken away, which has nothing to
   *  copy and so has no button. */
  import CopyButton from './CopyButton.svelte'

  const {
    value,
    label = '',
    plain = false,
    word = '',
    disabled = false,
  }: {
    /** What is shown, and what the button copies. */
    value: string
    /** The word before it. Absent where the row is on its own and the words
     *  around it already say what it is. */
    label?: string
    /** Set for a value that is a word rather than a thing to take away. */
    plain?: boolean
    /** What the button says, where `Copy` alone is not specific enough. */
    word?: string
    /** There is nothing here yet: a link that has not been made. The row is drawn
     *  where it will be rather than appearing once it can be used. */
    disabled?: boolean
  } = $props()
</script>

<div class="copyable">
  {#if label}<span class="label">{label}</span>{/if}
  <code class="value" class:plain class:off={disabled}>{value}</code>
  {#if !plain}<CopyButton {value} {word} {disabled} />{/if}
</div>

<style>
  .copyable {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  .label {
    flex: none;
    width: 5.5rem;
    color: var(--muted);
  }

  .value {
    flex: 1;
    min-width: 0;
    padding: 6px 10px;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Nothing in it yet, so it reads as the place the value will be. */
  .value.off {
    color: var(--muted);
  }

  /* A word rather than a value: no field around it, and set like the words
     beside it. */
  .value.plain {
    border-color: transparent;
    background: none;
    padding-inline-start: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }

  /* A width and not a device class: this is the panel it sits in running out of
     room for a label and a field side by side, which happens on a desktop with
     the window dragged in as readily as on a phone. */
  @media (max-width: 480px) {
    .copyable {
      flex-wrap: wrap;
    }

    .label {
      width: 100%;
    }
  }
</style>

<script lang="ts">
  import { copyText } from './clipboard'

  const SAID_FOR = 1600

  const {
    value,
    wide = false,
    word = '',
    disabled = false,
  }: {
    value: string
    wide?: boolean
    word?: string
    disabled?: boolean
  } = $props()

  let said = $state(false)
  let saying: ReturnType<typeof setTimeout> | undefined

  async function copy() {
    await copyText(value)

    said = true
    clearTimeout(saying)
    saying = setTimeout(() => (said = false), SAID_FOR)
  }

  $effect(() => () => clearTimeout(saying))
</script>

<button class="copy" class:wide class:done={said} {disabled} onclick={() => void copy()}>
  {said ? 'Copied' : word || 'Copy'}
</button>

<style>
  .copy {
    flex: none;
    min-width: 4.4rem;
    padding: 6px 10px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-sm);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out),
      border-color var(--dur-fast) var(--ease-out);
  }

  .copy.wide {
    align-self: flex-start;
    min-width: 6rem;
  }

  .copy.done {
    border-color: var(--success);
    color: var(--success);
  }

  @media (hover: hover) {
    .copy:hover:not(.done):not(:disabled) {
      border-color: var(--accent);
      color: var(--accent);
    }
  }

  .copy:active:not(:disabled) {
    background: var(--press);
  }

  .copy:focus-visible {
    outline-offset: 2px;
  }
</style>

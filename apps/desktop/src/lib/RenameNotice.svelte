<script lang="ts">
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { dur, fly, scale } from './motion'
  import { renamed } from './renamed.svelte'
  import { told } from './said.svelte'

  const STAYS = 6000

  const said = $derived(t('nibeditor is now Orden'))

  onMount(() => {
    const gone = () => renamed.dismiss()
    const timer = setTimeout(gone, STAYS)
    window.addEventListener('pointerdown', gone, { capture: true })
    window.addEventListener('keydown', gone, { capture: true })

    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerdown', gone, { capture: true })
      window.removeEventListener('keydown', gone, { capture: true })
    }
  })
</script>

<div
  class="notice"
  transition:fly={{ y: 12, duration: dur(220), easing: cubicOut }}
  {@attach told(said)}
>
  <img
    class="mark"
    src="/icon-256.png"
    alt=""
    draggable="false"
    in:scale={{ start: 0.6, delay: dur(120), duration: dur(320), easing: cubicOut }}
  />
  <p>{said}</p>
</div>

<style>
  .notice {
    grid-column: 2;
    justify-self: center;
    max-width: 22rem;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    box-shadow: var(--shadow-lg);
  }

  :global(.notices) > .notice {
    pointer-events: none;
  }

  .mark {
    flex: none;
    width: 1.5rem;
    height: 1.5rem;
  }

  p {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    color: var(--text);
  }

  :global([data-touch]) .notice {
    grid-column: 1;
    justify-self: stretch;
    max-width: none;
  }
</style>

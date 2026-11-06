<script lang="ts">
  import { t } from './i18n.svelte'
  import type { PairField, SwatchOption } from './preferences'

  const {
    options,
    label,
    chosen,
    onchoose,
    onpoint,
    pair,
  }: {
    options: SwatchOption[]
    label: string
    chosen: string
    onchoose: (value: string) => void
    onpoint?: ((value: string | null) => void) | undefined
    pair?: PairField | undefined
  } = $props()

  function pick(which: number, colour: string, kept: boolean) {
    if (!pair) return
    const [first, second] = pair.get()
    const next: [string, string] = which === 0 ? [colour, second] : [first, colour]
    if (kept) pair.set(...next)
    else pair.preview(...next)
  }
</script>

<div class="swatches" role="group" aria-label={label} onpointerleave={() => onpoint?.(null)}>
  {#each options as one (one.value)}
    <button
      type="button"
      class="swatch"
      class:active={chosen === one.value}
      title={one.label}
      aria-label={one.label}
      aria-pressed={chosen === one.value}
      style:--swatch={one.colour}
      onpointermove={() => onpoint?.(one.value)}
      onclick={() => onchoose(one.value)}
    ></button>
  {/each}

  {#if pair}
    {@const own = pair.own()}
    {#each pair.get() as colour, which (which)}
      <label
        class="swatch picked"
        class:active={own}
        class:wheel={!own}
        title={t('Another colour')}
        style:--swatch={own ? colour : undefined}
      >
        <input
          type="color"
          value={colour}
          aria-label={t('Another colour')}
          oninput={(event) => pick(which, event.currentTarget.value, false)}
          onchange={(event) => pick(which, event.currentTarget.value, true)}
        />
      </label>
    {/each}
  {/if}
</div>

<style>
  .swatches {
    --swatch-edge: color-mix(in srgb, var(--text) 12%, transparent);
    --swatch-size: 24px;
    display: flex;
    flex-wrap: wrap;
    gap: 7px;
  }

  :global(.nib-setting-value.is-wrapping) > .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, var(--swatch-size));
    justify-content: space-between;
    padding: 4px;
  }

  .swatch {
    position: relative;
    width: var(--swatch-size);
    height: var(--swatch-size);
    padding: 0;
    border: none;
    border-radius: 50%;
    background: var(--swatch);
    box-shadow: inset 0 0 0 1px var(--swatch-edge);
    cursor: default;
    transition: transform var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .swatch:hover {
      transform: scale(1.12);
    }
  }

  .swatch.active {
    background: none;
  }

  .swatch.active::before,
  .swatch.active::after {
    content: '';
    position: absolute;
    border-radius: 50%;
    background: var(--swatch);
  }

  .swatch.active::before {
    inset: -4px;
  }

  .swatch.active::after {
    inset: 0;
    box-shadow:
      inset 0 0 0 1px var(--swatch-edge),
      0 0 0 2px var(--surface);
  }

  .picked {
    overflow: visible;
    cursor: pointer;
  }

  .wheel {
    --swatch: conic-gradient(#bfddfb, #c4ece0, #efe3c6, #fbdcc4, #f1c4d6, #ddd0f7, #bfddfb);
  }

  .picked input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    padding: 0;
    border: none;
    background: none;
    opacity: 0;
    cursor: pointer;
  }

  :global([data-touch]) .swatches {
    --swatch-size: var(--touch-target);
    gap: 12px;
  }
</style>

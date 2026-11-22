<script lang="ts">
  import { untrack } from 'svelte'
  import { DEFAULT_PAGE_SETUP, ORIENTATIONS, type PageSetup, PAPER_SIZES } from '@orden/contracts'
  import { choices } from '../../modes/src/api'
  import { Hint, Select, Sheet } from '../../ui-controls/src/api'
  import { segmented, viewport } from '../../ui-kit/src/api'
  import { openTarget, renderOptions } from './context'
  import { pdfAsk } from './pdf-ask.svelte'
  import type { PdfPreview } from './pdf-preview'

  const SETTLE = 250
  const FILLED = '${title}, ${date} and ${year} are filled in.'
  const PAPERS = PAPER_SIZES.map((size) => ({ value: size, label: size }))
  const TURNS: Record<PageSetup['orientation'], string> = { portrait: 'Portrait', landscape: 'Landscape' }
  type Appearance = typeof choices.exportAppearance
  const APPEARANCES: { value: Appearance; label: string }[] = [
    { value: 'light', label: 'Light' },
    { value: 'dark', label: 'Dark' },
    { value: 'app', label: 'Match the app' },
  ]
  let preview = $state<PdfPreview | null>(null)
  let boxWidth = $state(0)
  let boxHeight = $state(0)
  let drawn = 0
  const scale = $derived(preview ? Math.min(boxWidth / preview.width, boxHeight / preview.height) : 0)
  async function draw(page: PageSetup, appearance: Appearance) {
    const mine = ++drawn
    const target = openTarget()
    const [out, options] = await Promise.all([import('./exporters'), renderOptions(target, page, appearance)])
    const shown = await out.pdfPreview(target, options)
    if (mine === drawn && pdfAsk.open) preview = shown
  }
  $effect(() => {
    if (!pdfAsk.open) return
    const page = choices.page
    const appearance = choices.exportAppearance
    const timer = setTimeout(
      () => void draw(page, appearance).catch(() => undefined),
      untrack(() => preview) ? SETTLE : 0,
    )
    return () => clearTimeout(timer)
  })
  function choosePaper(value: string) {
    const paper = PAPER_SIZES.find((one) => one === value)
    if (paper) choices.setPage({ paper })
  }
  function chooseAppearance(value: string) {
    const appearance = APPEARANCES.find((one) => one.value === value)?.value
    if (appearance) choices.setExportAppearance(appearance)
  }
  function close(go: boolean) {
    drawn += 1
    preview = null
    pdfAsk.answer(go)
  }
</script>

<Sheet open={pdfAsk.open} title="Export as PDF" width="50rem" onclose={() => close(false)}>
  <div class="split">
    <div class="paper" bind:clientWidth={boxWidth} bind:clientHeight={boxHeight}>
      {#if preview && scale > 0}
        <div class="page" style:width="{preview.width * scale}px" style:height="{preview.height * scale}px">
          <iframe
            class="preview"
            title="Preview"
            sandbox="allow-same-origin"
            tabindex="-1"
            srcdoc={preview.html}
            style:width="{preview.width}px"
            style:height="{preview.height}px"
            style:transform="scale({scale})"
          ></iframe>
        </div>
      {/if}
    </div>

    <div class="fields">
      <div class="orden-setting">
        <span class="name">Paper</span>
        <div class="orden-setting-value">
          <Select
            value={choices.page.paper}
            options={PAPERS}
            label="Paper"
            plain={viewport.touch}
            onchange={choosePaper}
          />
        </div>
      </div>
      <div class="orden-setting">
        <span class="name">Orientation</span>
        <div class="orden-setting-value"><div class="orden-segmented" role="radiogroup" aria-label="Orientation" use:segmented>
          {#each ORIENTATIONS as one (one)}
            <button
              type="button"
              role="radio"
              aria-checked={choices.page.orientation === one}
              class:on={choices.page.orientation === one}
              onclick={() => choices.setPage({ orientation: one })}
            >
              {TURNS[one]}
            </button>
          {/each}
        </div></div>
      </div>
      <label class="orden-setting">
        <span class="name">Margin</span>
        <input
          class="orden-field is-value"
          type="text"
          value={choices.page.margin}
          placeholder={DEFAULT_PAGE_SETUP.margin}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          oninput={(event) => choices.setPage({ margin: event.currentTarget.value })}
        />
      </label>
      <label class="orden-setting">
        <span class="name"><span class="what">Header<Hint text={FILLED} /></span></span>
        <input
          class="orden-field is-value"
          type="text"
          value={choices.page.header}
          placeholder={'${title}'}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          oninput={(event) => choices.setPage({ header: event.currentTarget.value })}
        />
      </label>
      <label class="orden-setting">
        <span class="name"><span class="what">Footer<Hint text={FILLED} /></span></span>
        <input
          class="orden-field is-value"
          type="text"
          value={choices.page.footer}
          placeholder={'${date}'}
          spellcheck="false"
          autocapitalize="off"
          autocomplete="off"
          oninput={(event) => choices.setPage({ footer: event.currentTarget.value })}
        />
      </label>
      <div class="orden-setting">
        <span class="name">Appearance</span>
        <div class="orden-setting-value">
          <Select
            value={choices.exportAppearance}
            options={APPEARANCES}
            label="Appearance"
            plain={viewport.touch}
            onchange={chooseAppearance}
          />
        </div>
      </div>
    </div>
  </div>

  {#snippet foot()}
    <button class="orden-button is-quiet cancel" onclick={() => close(false)}>Cancel</button>
    <button class="orden-button go" onclick={() => close(true)}>Export</button>
  {/snippet}
</Sheet>

<style>
  .split {
    display: flex;
    gap: var(--space-4);
    padding: 0 var(--space-2);
  }
  .paper {
    flex: 1;
    min-width: 0;
    height: min(30rem, 60dvh);
    display: grid;
    place-items: center;
    border-radius: var(--radius-md);
    background: var(--surface-2);
    overflow: hidden;
  }
  .page {
    position: relative;
    overflow: hidden;
    background: #ffffff;
    box-shadow: var(--shadow-md);
  }
  .preview {
    position: absolute;
    top: 0;
    left: 0;
    border: none;
    transform-origin: 0 0;
    pointer-events: none;
  }
  .fields {
    flex: none;
    width: 19rem;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    --setting-value: 10rem;
  }
  .cancel {
    margin-inline-start: auto;
  }
  :global([data-touch]) .split {
    flex-direction: column;
  }
  :global([data-touch]) .paper {
    flex: none;
    height: 40dvh;
  }
  :global([data-touch]) .fields {
    width: auto;
  }
  :global([data-touch]) .cancel,
  :global([data-touch]) .go {
    flex: 1;
    justify-content: center;
  }
</style>

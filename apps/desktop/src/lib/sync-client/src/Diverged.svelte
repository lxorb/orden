<script lang="ts">
  import { tick } from 'svelte'
  import Sheet from '../../Sheet.svelte'
  import { withinSpace } from '../../space-paths'
  import { readableSize } from '../../usage.svelte'
  import { when } from '../../when'
  import { workspace } from './ports'
  import { asking, type Held, type HeldAnswer, type Side } from './asking.svelte'
  import { runsOf } from './runs'

  const ARMING = 400

  let last: Held | null = null
  const shown = $derived.by(() => {
    const now = asking.asked
    if (now) last = now
    return now ?? last
  })

  const newer = $derived<HeldAnswer>(shown && shown.mine.at >= shown.theirs.at ? 'mine' : 'theirs')

  let since = 0
  $effect(() => {
    if (asking.asked) since = performance.now()
  })

  function keep(event: MouseEvent, answer: HeldAnswer) {
    if (!shown) return
    if (event.detail === 0 && performance.now() - since < ARMING) return
    void asking.answer(shown, answer)
  }

  function stepping(node: HTMLElement) {
    const step = (event: KeyboardEvent) => {
      const key = event.key
      if (key !== 'ArrowLeft' && key !== 'ArrowRight') return
      const keeps = [...node.querySelectorAll<HTMLButtonElement>('.keep')]
      const next = keeps[key === 'ArrowRight' ? 1 : 0]
      if (!next) return
      event.preventDefault()
      next.focus()
    }
    node.addEventListener('keydown', step)
    return { destroy: () => node.removeEventListener('keydown', step) }
  }

  function planeOf(node: HTMLElement, text: string) {
    void (async () => {
      const path = shown?.path ?? null
      const space = path
        ? workspace().spaces.find((one) => withinSpace(one.root, path) !== null)
        : null
      const [{ drawingOf }, { canvasSvg }, { pdfFaces }] = await Promise.all([
        import('../../export/drawing'),
        import('../../canvas/picture'),
        import('../../canvas/faces'),
      ])
      const drawing = drawingOf({
        text,
        name: shown?.name ?? '',
        path: space && path ? withinSpace(space.root, path) : null,
        root: space?.root ?? null,
      })
      const faces = await pdfFaces(drawing.canvas.nodes, { note: path, root: drawing.root })
      await tick()
      if (!node.isConnected) return
      node.innerHTML = canvasSvg(
        drawing.canvas,
        drawing.palette,
        drawing.path,
        drawing.root,
        true,
        false,
        faces,
      )
      const picture = node.firstElementChild
      picture?.removeAttribute('width')
      picture?.removeAttribute('height')
    })()
  }
</script>

<Sheet
  open={asking.asked !== null}
  title={shown?.name ?? ''}
  width="var(--screen-pair)"
  onclose={() => asking.dismiss()}
>
  {#if shown}
    <div class="sides" use:stepping>
      {@render card(shown.mine, 'mine')}
      {@render card(shown.theirs, 'theirs')}
    </div>
    {#if asking.wrong}<p class="wrong">{asking.wrong}</p>{/if}
  {/if}

  {#snippet foot()}
    <button
      class="orden-button is-quiet both"
      class:is-pressing={asking.answering === 'both'}
      aria-busy={asking.answering === 'both'}
      disabled={asking.answering !== null && asking.answering !== 'both'}
      onclick={(event) => keep(event, 'both')}
    >
      Keep both
    </button>
  {/snippet}
</Sheet>

{#snippet card(side: Side, whose: HeldAnswer)}
  {@const head = `diverged-${whose}`}
  <section class="card side" aria-labelledby={head}>
    <header id={head}>
      <span class="device">
        {whose === 'mine' ? `This ${side.device}` : side.device}
      </span>
      <time datetime={new Date(side.at).toISOString()}>{when(side.at, 'short')}</time>
    </header>

    {#if side.plane !== undefined}
      <div class="plane" use:planeOf={side.plane}></div>
    {:else if side.file}
      <div class="file">
        {#if side.file.picture}
          <img src={side.file.picture} alt="" draggable="false" />
        {/if}
        <span class="called">{side.file.name}</span>
        <span class="size">{readableSize(side.file.size)}</span>
      </div>
    {:else}
      <p class="excerpt" dir="auto">
        {#each runsOf(side.excerpt) as run, at (at)}{#if run.marked}<mark>{run.text}</mark
            >{:else}{run.text}{/if}{/each}
      </p>
    {/if}

    <button
      class="orden-button keep"
      class:is-pressing={asking.answering === whose}
      aria-busy={asking.answering === whose}
      aria-describedby={head}
      disabled={asking.answering !== null && asking.answering !== whose}
      data-lands={whose === newer ? '' : undefined}
      onclick={(event) => keep(event, whose)}
    >
      Keep
    </button>
  </section>
{/snippet}

<style>
  .sides {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr));
    gap: var(--space-3);
  }

  .sides > .side {
    gap: var(--space-3);
    min-width: 0;
    padding: var(--space-3);
  }

  header {
    display: flex;
    align-items: baseline;
    gap: var(--space-3);
    font-size: var(--text-sm);
  }

  .device {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    unicode-bidi: isolate;
  }

  time {
    flex: none;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .excerpt {
    flex: 1;
    min-height: 3lh;
    max-height: 14rem;
    margin: 0;
    overflow-y: auto;
    font-family: var(--font-content);
    font-size: var(--text-base);
    line-height: 1.6;
    color: var(--text);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  mark {
    margin: 0 -0.18em;
    padding: 0.1em 0.18em;
    border-radius: 3px;
    background: var(--accent-soft);
    color: var(--text-strong);
    box-decoration-break: clone;
    -webkit-box-decoration-break: clone;
  }

  .plane {
    flex: 1;
    display: grid;
    place-items: center;
    min-height: 6rem;
    max-height: 14rem;
    overflow: hidden;
    border-radius: var(--radius-row);
  }

  .plane :global(svg) {
    display: block;
    max-width: 100%;
    max-height: 14rem;
  }

  .file {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    font-size: var(--text-sm);
    color: var(--text);
  }

  .file img {
    max-width: 100%;
    max-height: 10rem;
    object-fit: contain;
    border-radius: var(--radius-row);
  }

  .file .called {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .file .size {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .keep {
    align-self: flex-end;
  }

  .both {
    margin-inline: auto;
  }

  .keep.is-pressing {
    background: var(--accent-press);
    transform: none;
  }

  .both.is-pressing {
    background: var(--surface-press);
    color: var(--text-strong);
  }

  :global([data-touch]) .keep {
    align-self: stretch;
  }

  :global([data-touch]) header {
    font-size: var(--text-base);
  }
</style>

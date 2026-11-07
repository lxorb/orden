<script lang="ts">
  import type { Box } from './canvas/geometry'
  import {
    closeUpOf,
    densityFor,
    holdPaper,
    type Paper,
    paperEdition,
    paperOf,
    type Part,
  } from './pages/paper'
  import FileMark from './FileMark.svelte'
  import { pixelRatio } from './pixel-ratio.svelte'

  const {
    file,
    note,
    root,
    box = null,
    scale = 1,
    seen = null,
  }: {
    file: string
    note: string | null
    root: string | null
    box?: Box | null
    scale?: number
    seen?: Box | null
  } = $props()

  const FIRST = 2

  const CLOSE_UP = 160

  const STRETCH = 1.1

  let sheet = $state<HTMLCanvasElement>()
  let close = $state<HTMLCanvasElement>()
  let paper = $state.raw<Paper | null>(null)
  let closeUp = $state.raw<Part | null>(null)
  let wide = $state(0)
  let tall = $state(0)

  const fit = $derived(
    paper && wide && tall ? Math.min(wide / paper.width, tall / paper.height) : 0,
  )

  const wanted = $derived(fit * scale * pixelRatio.now)

  const density = $derived(wanted ? densityFor(wanted) : FIRST)

  $effect(() => {
    const release = holdPaper({ file, note, root })
    return () => {
      paper = null
      closeUp = null
      release()
    }
  })

  $effect(() => {
    const at = { file, note, root }
    const asked = density
    paperEdition(at)
    const leaving = new AbortController()
    void paperOf(at, 1, leaving.signal, false, asked).then((drawn) => {
      if (!leaving.signal.aborted && drawn) paper = drawn
    })
    return () => leaving.abort()
  })

  $effect(() => {
    const target = sheet
    const image = paper?.image
    if (!target || !image) return

    target.width = image.width
    target.height = image.height
    target.getContext('2d')?.drawImage(image, 0, 0)
  })

  const part = $derived.by((): Part | null => {
    if (!paper || !box || !seen || !fit) return null
    if (wanted <= (paper.image.width / paper.width) * STRETCH) return null

    const left = box.x + (box.width - paper.width * fit) / 2
    const top = box.y + (box.height - paper.height * fit) / 2
    const from = Math.max(0, Math.floor((seen.x - left) / fit))
    const to = Math.min(paper.width, Math.ceil((seen.x + seen.width - left) / fit))
    const above = Math.max(0, Math.floor((seen.y - top) / fit))
    const below = Math.min(paper.height, Math.ceil((seen.y + seen.height - top) / fit))
    if (to <= from || below <= above) return null

    return {
      x: from / paper.width,
      y: above / paper.height,
      width: (to - from) / paper.width,
      height: (below - above) / paper.height,
    }
  })

  $effect(() => {
    const want = part
    const across = paper ? paper.width * wanted : 0
    if (!want || !across) {
      closeUp = null
      return
    }

    const at = { file, note, root }
    paperEdition(at)
    const leaving = new AbortController()
    const timer = setTimeout(() => {
      void closeUpOf(at, 1, want, across, leaving.signal).then((image) => {
        if (!image) return
        if (leaving.signal.aborted || !close) {
          image.close()
          return
        }

        close.width = image.width
        close.height = image.height
        close.getContext('2d')?.drawImage(image, 0, 0)
        image.close()
        closeUp = want
      })
    }, CLOSE_UP)

    return () => {
      clearTimeout(timer)
      leaving.abort()
    }
  })

  const name = $derived(file.split(/[\\/]/).pop() ?? file)
</script>

<div class="pdf" aria-label={name} bind:clientWidth={wide} bind:clientHeight={tall}>
  <div
    class="paper"
    style:width={paper && fit ? `${paper.width * fit}px` : '100%'}
    style:height={paper && fit ? `${paper.height * fit}px` : '100%'}
  >
    <canvas bind:this={sheet}></canvas>
    {#if part}
      <canvas
        bind:this={close}
        class="close"
        class:there={!!closeUp}
        style:left="{(closeUp?.x ?? 0) * 100}%"
        style:top="{(closeUp?.y ?? 0) * 100}%"
        style:width="{(closeUp?.width ?? 0) * 100}%"
        style:height="{(closeUp?.height ?? 0) * 100}%"
      ></canvas>
    {/if}
  </div>
  <span class="name"><FileMark mark="pdf" /><span>{name}</span></span>
</div>

<style>
  .pdf {
    position: relative;
    width: 100%;
    height: 100%;
    display: grid;
    place-items: center;
    overflow: hidden;
    background: var(--surface);
  }

  .paper {
    position: relative;
    background: white;
  }

  canvas {
    display: block;
    width: 100%;
    height: 100%;
  }

  canvas.close {
    position: absolute;
    opacity: 0;
  }

  canvas.close.there {
    opacity: 1;
  }

  .name {
    position: absolute;
    right: 4px;
    bottom: 4px;
    left: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 6px;
    border-radius: var(--radius-sm);
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    color: var(--text-strong);
    font: var(--text-sm) / 1.2 var(--font-ui);
  }

  .name span:last-child {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

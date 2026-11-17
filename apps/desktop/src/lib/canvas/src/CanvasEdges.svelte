<script lang="ts">
  import type { CanvasEdge, CanvasNode, Side } from '@orden/markdown/canvas'
  import { arrowAt, boxOf, edgeEnds, edgeMiddle, edgePath, facingSide } from '../../plane/src/api'
  import { shownColour } from '../../plane/src/api'

  const {
    edges,
    nodes,
    picked,
    provisional = null,
  }: {
    edges: readonly CanvasEdge[]
    nodes: readonly CanvasNode[]
    picked: ReadonlySet<string>
    provisional?: {
      from: { x: number; y: number }
      to: { x: number; y: number }
      side: Side
    } | null
  } = $props()

  const boxes = $derived(new Map(nodes.map((node) => [node.id, node])))

  const drawn = $derived(
    provisional
      ? edgePath({
          from: provisional.from,
          to: provisional.to,
          fromSide: provisional.side,
          toSide: facingSide(
            { ...provisional.to, width: 0, height: 0 },
            { ...provisional.from, width: 0, height: 0 },
          ),
        })
      : null,
  )

  const WEIGHT = 2
  const ARROW = 9
  const LABEL = 12

  const SPAN = 80000
  const HALF = SPAN / 2

  interface Drawn {
    id: string
    path: string
    colour: string | null
    picked: boolean
    heads: { x: number; y: number; angle: number }[]
    label: { x: number; y: number; text: string } | null
  }

  const lines = $derived.by((): Drawn[] => {
    const out: Drawn[] = []

    for (const edge of edges) {
      const from = boxes.get(edge.fromNode)
      const to = boxes.get(edge.toNode)
      if (!from || !to) continue

      const ends = edgeEnds(edge, boxOf(from), boxOf(to))
      const heads = []
      if (edge.fromEnd === 'arrow') heads.push(arrowAt(ends.from, ends.fromSide))
      if (edge.toEnd !== 'none') heads.push(arrowAt(ends.to, ends.toSide))

      const middle = edge.label === undefined ? null : edgeMiddle(ends)

      out.push({
        id: edge.id,
        path: edgePath(ends),
        colour: shownColour(edge.color),
        picked: picked.has(edge.id),
        heads,
        label: middle && edge.label !== undefined ? { ...middle, text: edge.label } : null,
      })
    }

    return out
  })
</script>

<svg
  class="edges"
  aria-hidden="true"
  width={SPAN}
  height={SPAN}
  style:left="{-HALF}px"
  style:top="{-HALF}px"
>
  <g transform="translate({HALF} {HALF})">
    {#each lines as edge (edge.id)}
      <g
        class="edge"
        class:picked={edge.picked}
        style:--edge-colour={edge.colour}
        data-edge={edge.id}
      >
        <path class="reach" d={edge.path} stroke-width={WEIGHT * 6} />
        <path class="line" d={edge.path} stroke-width={WEIGHT} />
        {#each edge.heads as head, index (index)}
          <path
            class="head"
            d="M 0 0 L {-ARROW} {-ARROW * 0.5} L {-ARROW} {ARROW * 0.5} Z"
            transform="translate({head.x} {head.y}) rotate({head.angle})"
          />
        {/each}
        {#if edge.label}
          <text class="words" x={edge.label.x} y={edge.label.y} font-size={LABEL}>
            {edge.label.text}
          </text>
        {/if}
      </g>
    {/each}

    {#if drawn}
      <path class="drawing" d={drawn} stroke-width={WEIGHT} />
    {/if}
  </g>
</svg>

<style>
  .edges {
    position: absolute;
    overflow: visible;
    pointer-events: none;
  }

  .line {
    fill: none;
    stroke: var(--edge-colour, var(--muted));
    stroke-linecap: round;
    transition: stroke var(--dur-fast) var(--ease-out);
  }

  .reach {
    fill: none;
    stroke: transparent;
    pointer-events: stroke;
  }

  .head {
    fill: var(--edge-colour, var(--muted));
    transition: fill var(--dur-fast) var(--ease-out);
  }

  .edge.picked .line,
  .edge:hover .line {
    stroke: var(--accent);
  }

  .edge.picked .head,
  .edge:hover .head {
    fill: var(--accent);
  }

  .words {
    fill: var(--text-strong);
    font-family: var(--font-ui);
    font-weight: var(--weight-strong);
    text-anchor: middle;
    dominant-baseline: middle;
    paint-order: stroke;
    stroke: var(--bg);
    stroke-width: 4;
    stroke-linejoin: round;
  }

  .drawing {
    fill: none;
    stroke: var(--accent);
    stroke-linecap: round;
    stroke-dasharray: 6 5;
  }
</style>

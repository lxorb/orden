<script lang="ts">
  /** Every connector on the plane, in one SVG layer.
   *
   *  One layer rather than one element per edge: an SVG with five hundred paths in
   *  it is one thing for the browser to keep, and the layer sits inside the plane
   *  so a pan and a zoom are the plane's own transform and touch nothing here.
   *
   *  Everything is in plane units, lines and arrow heads and labels alike, so the
   *  whole picture scales together the way a drawing should. */

  import type { CanvasEdge, CanvasNode } from './canvas/format'
  import { arrowAt, boxOf, edgeEnds, edgeMiddle, edgePath } from './canvas/geometry'
  import { shownColour } from './canvas/palette'

  const {
    edges,
    boxes,
    picked,
    provisional = null,
  }: {
    edges: readonly CanvasEdge[]
    /** The nodes an edge can end on, by id. Handed over already offset by
     *  whatever a drag has carried, so an edge follows the cards it joins. */
    boxes: Map<string, CanvasNode>
    picked: readonly string[]
    /** The edge being drawn from a node's side, while one is: a path and nothing
     *  else, since it has no second node yet. */
    provisional?: string | null
  } = $props()

  /** How thick a line is, how big an arrow head is, and how big a label reads, in
   *  plane units. */
  const WEIGHT = 2
  const ARROW = 9
  const LABEL = 12

  /** How much of the plane the layer covers, in plane units, and half of it.
   *
   *  An outermost SVG paints nothing outside its own viewport, whatever
   *  `overflow` says, so the layer cannot be the zero-sized box the cards sit in:
   *  it needs room of its own. This is far more plane than any canvas anybody
   *  draws, and the browser only ever rasterises the part that is on screen. */
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

  const drawn = $derived.by((): Drawn[] => {
    const out: Drawn[] = []

    for (const edge of edges) {
      const from = boxes.get(edge.fromNode)
      const to = boxes.get(edge.toNode)
      // A node out of view takes its edges with it; the ends have nowhere to be.
      if (!from || !to) continue

      const ends = edgeEnds(edge, boxOf(from), boxOf(to))
      const heads = []
      // `none` at the start and `arrow` at the end unless the file says otherwise,
      // which is what the spec says.
      if (edge.fromEnd === 'arrow') heads.push(arrowAt(ends.from, ends.fromSide))
      if (edge.toEnd !== 'none') heads.push(arrowAt(ends.to, ends.toSide))

      const middle = edge.label === undefined ? null : edgeMiddle(ends)

      out.push({
        id: edge.id,
        path: edgePath(ends),
        colour: shownColour(edge.color),
        picked: picked.includes(edge.id),
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
  <!-- The plane's origin, moved to the middle of the layer, so everything inside
       is written in the coordinates the file uses. -->
  <g transform="translate({HALF} {HALF})">
    {#each drawn as edge (edge.id)}
      <g
        class="edge"
        class:picked={edge.picked}
        style:--edge-colour={edge.colour}
        data-edge={edge.id}
      >
        <!-- A wide, invisible line under the visible one, so an edge can be
             clicked without asking anybody to hit two pixels. -->
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

    {#if provisional}
      <path class="drawing" d={provisional} stroke-width={WEIGHT} />
    {/if}
  </g>
</svg>

<style>
  /* Sized rather than clipped to nothing, and offset so the plane's origin falls
     in the middle of it; see SPAN above. */
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

  /* The label sits on the line with the plane showing through around it, which
     is enough to read it against a card underneath. */
  .words {
    fill: var(--text-strong);
    font-family: var(--font-ui);
    font-weight: 550;
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

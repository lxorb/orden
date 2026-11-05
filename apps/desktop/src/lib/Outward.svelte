<!-- The arrow after the words of a link that leaves the app, which every such link
     carries. Written straight after the last word, with no space between
     (`{words}<Outward />`): it is `.nib-mark` in the themes package, which sits it on
     the middle of the words' letters and keeps it on the line of the last one, so it
     never stands on a line by itself (#1061). Turned over under an interface that
     reads the other way, as every mark pointing along the line is. -->
<span class="nib-mark nib-outward" aria-hidden="true"
  >&#8288;<svg class="nib-mirror" viewBox="0 0 16 16"><path d="M6 3h7v7M13 3L5 11" /></svg></span
>

<style>
  /* Its size and gap, said on the element the link's words are in. */
  :global(:has(> .nib-outward)) {
    --mark-gap: 4px;
    --mark-size: 12px;
  }

  svg {
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>

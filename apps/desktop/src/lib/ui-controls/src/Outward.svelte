<script lang="ts">
  import { marked } from './marked'
</script>

<span class="orden-mark orden-outward" aria-hidden="true" use:marked={'outward'}
  >&#8288;<svg viewBox="0 0 16 16"><path d="M6 3h7v7M13 3L5 11" /></svg></span
>

<style>
  :global(.orden-marked-outward) {
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

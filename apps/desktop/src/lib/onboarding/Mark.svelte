<script lang="ts">
  interface Props {
    size: number
    assemble?: boolean
  }

  const { size, assemble = false }: Props = $props()
</script>

<svg
  class="mark"
  class:assemble
  width={size}
  height={size}
  viewBox="0 0 256 256"
  aria-hidden="true"
>
  <rect x="62" y="62" width="93" height="35" rx="11" style:--dx="-40px" style:--dy="0px" />
  <rect x="160" y="62" width="35" height="93" rx="11" style:--dx="0px" style:--dy="-40px" />
  <rect x="101" y="160" width="94" height="35" rx="11" style:--dx="40px" style:--dy="0px" />
  <rect x="62" y="101" width="35" height="93" rx="11" style:--dx="0px" style:--dy="40px" />
</svg>

<style>
  .mark {
    display: block;
  }

  rect {
    fill: #1b2232;
  }

  .assemble rect {
    animation: snap 0.9s var(--ease-spring) both;
  }

  .assemble rect:nth-child(2) {
    animation-delay: 0.1s;
  }

  .assemble rect:nth-child(3) {
    animation-delay: 0.2s;
  }

  .assemble rect:nth-child(4) {
    animation-delay: 0.3s;
  }

  @keyframes snap {
    from {
      opacity: 0;
      transform: translate(var(--dx), var(--dy));
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .assemble rect {
      animation: none;
    }
  }
</style>

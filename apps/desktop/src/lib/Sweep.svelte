<script lang="ts">
</script>

<div class="track">
  <div class="run"></div>
</div>

<style>
  .track {
    width: 100%;
    height: 2px;
    overflow: hidden;
    border-radius: 1px;
  }

  .run {
    width: 34%;
    height: 100%;
    border-radius: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: sweep 1150ms var(--ease-in-out) infinite;
  }

  @keyframes sweep {
    from {
      transform: translateX(-100%);
    }
    to {
      transform: translateX(300%);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .run {
      width: 100%;
      animation: none;
      background: var(--accent);
      opacity: 0.5;
    }
  }
</style>

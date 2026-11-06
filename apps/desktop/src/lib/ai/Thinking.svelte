<script lang="ts">
</script>

<div class="thinking" aria-hidden="true"><span></span></div>

<style>
  .thinking {
    display: flex;
    padding: var(--space-1) 0;
  }

  .thinking span {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: var(--text-strong);
    animation: pulse calc(var(--dur-slow) * 3) var(--ease-in-out) infinite;
  }

  @keyframes pulse {
    0%,
    100% {
      opacity: 0.35;
      scale: 0.8;
    }
    50% {
      opacity: 1;
      scale: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .thinking span {
      animation: none;
      opacity: 0.6;
    }
  }
</style>

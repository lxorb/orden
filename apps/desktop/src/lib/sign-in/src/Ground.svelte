<script lang="ts">
  import type { Snippet } from 'svelte'

  const { wide = true, children }: { wide?: boolean; children?: Snippet } = $props()
</script>

<div class="ground" class:wide>
  <div class="aura" aria-hidden="true"></div>
  {@render children?.()}
</div>

<style>
  .ground {
    --glow-a: #1b2a44;
    --glow-b: #33203d;
    --glow-c: #221f45;
    --card: var(--surface);
    position: absolute;
    inset: 0;
    overflow: clip;
  }
  :global([data-theme='light']) .ground {
    --glow-a: #c9ddf8;
    --glow-b: #ecd1f1;
    --glow-c: #dcd6fb;
    --card: #fff;
  }
  .aura {
    position: absolute;
    inset: -20%;
    pointer-events: none;
    opacity: 0.45;
    background:
      radial-gradient(40% 45% at 22% 18%, var(--glow-a), transparent 70%),
      radial-gradient(38% 42% at 82% 82%, var(--glow-b), transparent 70%),
      radial-gradient(30% 35% at 70% 20%, var(--glow-c), transparent 70%);
    filter: blur(10px);
    animation: drift 8s var(--ease-out) both;
    transition: opacity 0.8s var(--ease-out);
  }
  .wide .aura {
    opacity: 1;
  }
  @keyframes drift {
    to {
      transform: translate3d(3%, -2%, 0) rotate(6deg) scale(1.05);
    }
  }
  .ground :global(.rise) {
    animation: rise 0.6s var(--ease-out) both;
  }
  .ground :global(.rise:nth-child(2)) {
    animation-delay: 0.06s;
  }
  .ground :global(.rise:nth-child(3)) {
    animation-delay: 0.12s;
  }
  .ground :global(.rise:nth-child(4)) {
    animation-delay: 0.18s;
  }
  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(14px);
    }
  }
  .ground :global(.o-field) {
    width: min(360px, 100%);
    height: 50px;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--card);
    padding: 0 16px;
    font: inherit;
    font-size: 16px;
    color: var(--text);
  }
  .ground :global(.o-error) {
    margin: 0;
    color: var(--danger);
    font-size: 14px;
    text-align: center;
  }
  @media (prefers-reduced-motion: reduce) {
    .aura,
    .ground :global(.rise) {
      animation: none;
    }
  }
</style>

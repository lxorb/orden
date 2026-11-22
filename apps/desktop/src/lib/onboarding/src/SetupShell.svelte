<div class="shell" data-covers="all" role="dialog" aria-modal="true" aria-label="Orden" aria-busy="true">
  <i class="tile"></i>
  <i class="line"></i>
  <i class="field"></i>
</div>

<style>
  .shell {
    position: fixed;
    inset: 0;
    z-index: var(--z-stage);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 24px;
    background: var(--bg);
  }
  i {
    display: block;
    border-radius: 12px;
    background: var(--surface-3);
    animation: wait 1.2s ease-in-out infinite alternate;
  }
  .tile {
    width: 88px;
    height: 88px;
    border-radius: 22px;
    background: linear-gradient(135deg, #c8ddfa, #e8c9ef);
  }
  .line {
    width: min(280px, 70vw);
    height: 30px;
  }
  .field {
    width: min(360px, 80vw);
    height: 50px;
  }
  @keyframes wait {
    to {
      opacity: 0.55;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    i {
      animation: none;
    }
  }
</style>

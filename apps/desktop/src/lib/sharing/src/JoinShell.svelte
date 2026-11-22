<div class="shell" data-covers="all" role="status" aria-busy="true" aria-label="Opening what was shared with you">
  <i class="title"></i>
  <i class="line"></i>
  <i class="line short"></i>
</div>

<style>
  .shell {
    position: fixed;
    inset: 0;
    z-index: calc(var(--z-screen) - 1);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    background: var(--bg);
  }
  i {
    display: block;
    border-radius: 8px;
    background: var(--surface-3);
    animation: wait 1.2s ease-in-out infinite alternate;
  }
  .title {
    width: min(320px, 70vw);
    height: 28px;
    margin-bottom: 10px;
  }
  .line {
    width: min(420px, 84vw);
    height: 14px;
  }
  .short {
    width: min(300px, 64vw);
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

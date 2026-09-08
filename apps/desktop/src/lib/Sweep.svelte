<script lang="ts">
  /** The line the app draws for work worth waiting on: the thinnest thing that
   *  can still be seen moving.
   *
   *  Its own component because two places want the same line and neither wants
   *  the other's box: along the top edge of a document for an export or an
   *  import, and under the mark on the surface an account's first sync holds.
   *  Whoever draws it decides how wide it is; see Progress.svelte and
   *  Arriving.svelte. */
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

  /* Movement is the point, so with movement turned down the line simply sits
     there: still a sign that something is running. */
  @media (prefers-reduced-motion: reduce) {
    .run {
      width: 100%;
      animation: none;
      background: var(--accent);
      opacity: 0.5;
    }
  }
</style>

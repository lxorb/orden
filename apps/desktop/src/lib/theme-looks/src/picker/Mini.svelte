<script lang="ts">
  import type { Look } from './looks'

  const {
    looks,
    desk = false,
    pictured = false,
  }: { looks: readonly Look[]; desk?: boolean; pictured?: boolean } = $props()
</script>

<span class="mini" class:desk class:pictured aria-hidden="true">
  {#each looks as look, index (index)}
    <span
      class="window"
      class:second={index > 0}
      style:--mini-ground={look.ground}
      style:--mini-side={look.side}
      style:--mini-frame={look.frame}
      style:--mini-text={look.text}
      style:--mini-muted={look.muted}
      style:--mini-line={look.line}
      style:--mini-accent={look.accent}
      style:--mini-open={look.open}
      style:--mini-picture={look.picture || undefined}
      style:--mini-scrim={look.scrim}
      style:--mini-floor={look.floor}
      style:--mini-dim={look.dim}
    >
      <span class="bar"><span class="tab"></span></span>
      <span class="side">
        <span class="row open"><span class="dot"></span></span>
        <span class="row"></span>
        <span class="row short"></span>
      </span>
      <span class="note">
        <span class="head"></span>
        <span class="line"></span>
        <span class="line"><span class="link"></span></span>
      </span>
    </span>
  {/each}
</span>

<style>
  .mini {
    position: relative;
    display: block;
    aspect-ratio: 16 / 10;
    border-radius: var(--radius-sm);
    overflow: hidden;
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 12%, transparent);
  }

  .window {
    position: absolute;
    inset: 0;
    z-index: var(--z-base);
    display: grid;
    grid-template-columns: 30% 1fr;
    grid-template-rows: 17% 1fr;
    background: var(--mini-ground);
  }

  .second {
    clip-path: polygon(100% 0, 100% 100%, 0 100%);
  }

  .bar {
    grid-column: 1 / -1;
    display: flex;
    align-items: flex-end;
    padding-inline-start: 34%;
    background: var(--mini-frame);
    border-bottom: 1px solid var(--mini-line);
  }

  .tab {
    width: 30%;
    height: 72%;
    border-radius: 3px 3px 0 0;
    background: var(--mini-ground);
  }

  .side {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 7px 6px;
    background: var(--mini-side);
    border-inline-end: 1px solid var(--mini-line);
  }

  .row {
    height: 3px;
    width: 80%;
    border-radius: 2px;
    background: var(--mini-muted);
    opacity: 0.55;
  }

  .row.short {
    width: 55%;
  }

  .row.open {
    display: flex;
    align-items: center;
    width: 100%;
    height: 8px;
    margin-inline-start: -3px;
    padding-inline-start: 3px;
    border-radius: 3px;
    background: var(--mini-open);
    opacity: 1;
  }

  .dot {
    width: 3px;
    height: 3px;
    border-radius: 50%;
    background: var(--mini-accent);
  }

  .note {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 9px 10px;
  }

  .head {
    width: 48%;
    height: 5px;
    border-radius: 2px;
    background: var(--mini-text);
  }

  .line {
    display: flex;
    justify-content: flex-end;
    width: 86%;
    height: 3px;
    border-radius: 2px;
    background: var(--mini-muted);
  }

  .line + .line {
    width: 68%;
  }

  .link {
    width: 34%;
    height: 100%;
    border-radius: 2px;
    background: var(--mini-accent);
  }

  .desk .window {
    background: linear-gradient(135deg, var(--canvas-5), var(--canvas-6) 55%, var(--canvas-2));
  }

  .desk .bar,
  .desk .side {
    background: color-mix(in srgb, var(--mini-frame) 64%, transparent);
  }

  .desk .note {
    background: var(--mini-ground);
  }

  .pictured .window {
    background:
      var(
          --mini-picture,
          radial-gradient(
            110% 90% at 0% 0%,
            color-mix(in srgb, var(--mini-accent) 40%, transparent),
            transparent 62%
          )
        )
        center / cover no-repeat,
      var(--mini-ground);
  }

  .pictured .bar,
  .pictured .side {
    border-color: transparent;
    background:
      linear-gradient(
        color-mix(in srgb, var(--mini-scrim) var(--mini-dim), transparent),
        color-mix(in srgb, var(--mini-scrim) var(--mini-dim), transparent)
      ),
      linear-gradient(
        color-mix(in srgb, var(--mini-scrim) var(--mini-floor), transparent),
        color-mix(in srgb, var(--mini-scrim) var(--mini-floor), transparent)
      );
  }

  .pictured .note {
    background: var(--mini-ground);
  }
</style>

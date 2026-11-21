<script lang="ts">
  import { stillness } from '../../platform/src/api'
  import { animate } from './animate'
  import { glyph, LOOKS, type Mood } from './faces'

  const { mood, size = 40, label }: { mood: Mood; size?: number; label?: string } = $props()
  const look = $derived(LOOKS[mood])
  let face = $derived(LOOKS[mood].rest)
  const PROPS = { zzz: 'zzz', dots: '...', question: '?', note: '♪', sparkle: '✧', wave: 'ﾉ', sweat: '' } as const

  $effect(() => {
    if (stillness()) return
    return animate(look, (one) => (face = one))
  })
</script>

<span
  class="mascot"
  role={label ? 'img' : undefined}
  aria-label={label}
  aria-hidden={label ? undefined : 'true'}
  style:font-size="{size}px"
>
  <span class="glyph" data-motion={look.motion} aria-hidden="true">{glyph(face)}</span>
  {#if face.prop}
    <span class="prop {face.prop}" aria-hidden="true">
      {#each PROPS[face.prop] as one, at (at)}<span style:--at={at}>{one}</span>{/each}
    </span>
  {/if}
</span>

<style>
  .mascot {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-weight: 400;
    line-height: 1.2;
    white-space: pre;
    user-select: none;
  }
  .glyph {
    display: inline-block;
    transform-origin: 50% 80%;
  }
  [data-motion='bob'] {
    animation: bob 3.2s var(--ease-in-out) infinite;
  }
  [data-motion='tilt'] {
    animation: tilt 4.4s var(--ease-in-out) infinite;
  }
  [data-motion='wobble'] {
    animation: wobble 1.8s var(--ease-in-out) infinite;
  }
  [data-motion='pulse'] {
    animation: pulse 1.6s var(--ease-in-out) infinite;
  }
  .prop {
    position: absolute;
    top: -0.25em;
    right: -0.35em;
    font-size: 0.5em;
    color: var(--muted);
  }
  .prop > span {
    display: inline-block;
  }
  .zzz > span {
    font-size: calc(0.7em + var(--at) * 0.2em);
    animation: rise 2.7s var(--ease-out) calc(var(--at) * 0.45s) infinite both;
  }
  .dots {
    top: auto;
    bottom: 0.2em;
    right: -0.75em;
  }
  .dots > span {
    animation: dot 1.4s var(--ease-in-out) calc(var(--at) * 0.2s) infinite both;
  }
  .question > span {
    animation: bob 2.6s var(--ease-in-out) infinite;
  }
  .note > span {
    animation: rise 2.4s var(--ease-out) infinite both;
  }
  .sparkle > span {
    color: var(--text-strong);
    animation: twinkle 1.1s var(--ease-out) both;
  }
  .wave {
    position: static;
    font-size: 1em;
    color: inherit;
  }
  .wave > span {
    transform-origin: 20% 90%;
    animation: wave 2.4s var(--ease-in-out) infinite;
  }
  .sweat {
    top: 0.18em;
    right: auto;
    left: 0.2em;
    width: 0.16em;
    height: 0.16em;
    font-size: 1em;
    border-radius: 0 50% 50% 50%;
    background: var(--accent);
    opacity: 0.85;
    transform: rotate(45deg);
    animation: slide 2.8s var(--ease-in-out) infinite;
  }
  @keyframes bob {
    50% {
      transform: translateY(-0.05em);
    }
  }
  @keyframes tilt {
    0%,
    100% {
      transform: rotate(-4deg);
    }
    50% {
      transform: rotate(4deg);
    }
  }
  @keyframes wobble {
    25% {
      transform: rotate(-3deg);
    }
    75% {
      transform: rotate(3deg);
    }
  }
  @keyframes pulse {
    15% {
      transform: scale(1.04);
    }
    30% {
      transform: scale(1);
    }
    45% {
      transform: scale(1.03);
    }
  }
  @keyframes rise {
    0% {
      opacity: 0;
      transform: translate(0, 0.4em);
    }
    30% {
      opacity: 1;
    }
    100% {
      opacity: 0;
      transform: translate(0.3em, -0.6em);
    }
  }
  @keyframes dot {
    0%,
    100% {
      opacity: 0.2;
    }
    40% {
      opacity: 1;
    }
  }
  @keyframes twinkle {
    0% {
      opacity: 0;
      transform: scale(0.4) rotate(-30deg);
    }
    40% {
      opacity: 1;
      transform: scale(1.1) rotate(0deg);
    }
    100% {
      opacity: 0;
      transform: scale(0.9);
    }
  }
  @keyframes wave {
    0%,
    40%,
    100% {
      transform: rotate(0deg);
    }
    10%,
    30% {
      transform: rotate(-14deg);
    }
    20% {
      transform: rotate(10deg);
    }
  }
  @keyframes slide {
    0%,
    30% {
      opacity: 0;
      transform: translateY(-0.1em) rotate(45deg);
    }
    45% {
      opacity: 0.85;
    }
    90% {
      opacity: 0;
      transform: translateY(0.45em) rotate(45deg);
    }
    100% {
      opacity: 0;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .mascot *,
    .mascot {
      animation: none !important;
    }
  }
</style>

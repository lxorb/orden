<script lang="ts">
  import { accentColour } from '../../theme/src/api'
  import { theme } from '../../theme/src/api'
  import {
    type SessionState,
    STATE_COLOURS,
    STATE_MARKS,
    STATE_WORDS,
  } from '../../ai-providers/src/api'

  const { state }: { state: SessionState } = $props()
</script>

<svg
  class="state"
  class:turning={state === 'running'}
  viewBox="0 0 13 13"
  style:color={accentColour(STATE_COLOURS[state], theme.current)}
  aria-hidden="true"><title>{STATE_WORDS[state]}</title><path d={STATE_MARKS[state]} /></svg
>

<style>
  .state {
    flex: none;
    width: var(--icon-sm);
    height: var(--icon-sm);
    fill: none;
    stroke: currentColor;
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .turning {
    animation: turn 1s linear infinite;
  }

  @media (prefers-reduced-motion: reduce) {
    .turning {
      animation: none;
    }
  }

  @keyframes turn {
    to {
      rotate: 1turn;
    }
  }
</style>

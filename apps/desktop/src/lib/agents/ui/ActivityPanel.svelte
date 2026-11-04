<script lang="ts">
  /** The agents' panel, until the Ask panel's chat list is the one place they are
   *  (#1120): each connected agent's session, the same one its row in that list opens;
   *  see AgentSession.svelte. */
  import { t } from '../../i18n.svelte'
  import { ASK_MARK } from '../../panel-marks'
  import AgentSession from './AgentSession.svelte'
  import { started } from './live.svelte'

  const activity = started()
</script>

<div class="panel">
  {#each activity.listed as agent (agent)}
    <AgentSession {agent} />
  {:else}
    <!-- Nobody connected: the mark the tab wears, and nothing to read. -->
    <div class="none" role="img" aria-label={t('Agents')}>
      <svg viewBox="0 0 13 13"><path d={ASK_MARK} /></svg>
    </div>
  {/each}
</div>

<style>
  .panel {
    display: flex;
    flex-direction: column;
    padding-bottom: var(--space-4);
  }

  .none {
    display: grid;
    place-items: center;
    padding: var(--space-6) 0;
    color: var(--faint);
  }

  .none svg {
    width: calc(var(--icon-lg) * 2);
    height: calc(var(--icon-lg) * 2);
    fill: none;
    stroke: currentColor;
    stroke-width: 0.8;
    stroke-linejoin: round;
  }
</style>

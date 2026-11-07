<script lang="ts">
  import { t } from '../../i18n.svelte'
  import { agentOpen } from '../../ai/sidebar/agent-open.svelte'
  import { chat } from '../../ai/sidebar/chat.svelte'
  import { asking } from './asking.svelte'
  import { started } from './live.svelte'
  import { ACTIVE_FOR } from './marks'
  import Spark from './Spark.svelte'

  const activity = started()

  const rows = $derived(
    activity.listed.map((agent) => {
      const last = activity.seen.doing[agent]
      const asks = [
        ...activity.questions.filter((one) => one.agent === agent).map((one) => one.summary),
        ...asking.of(agent).map((one) => one.message),
      ]
      return {
        agent,
        name: activity.nameOf(agent),
        colour: activity.colourOf(agent),
        connected: activity.seen.connected.includes(agent),
        stopped: activity.stopped(agent),
        acting: !!last && activity.now - last.at < ACTIVE_FOR,
        asking: asks[0] ?? null,
        asks: asks.length,
      }
    }),
  )

  function open(agent: string) {
    agentOpen.id = agent
    chat.listing = false
  }
</script>

{#if rows.length}
  <li class="group" role="presentation">{t('Agents')}</li>
  {#each rows as one (one.agent)}
    <li role="presentation">
      <button
        class="orden-row agent"
        class:is-on={agentOpen.id === one.agent}
        data-agent={one.agent}
        onclick={() => open(one.agent)}
      >
        <Spark colour={one.colour} turning={one.acting} paused={one.stopped} />
        <span class="orden-row-label">
          <span class="name">{one.name}</span>
          {#if one.asking}
            <span class="asking">{one.asking}</span>
          {/if}
        </span>
        {#if one.asks}
          <span class="asks" title={t('Waiting for you')}>{one.asks}</span>
        {/if}
        {#if one.connected}
          <span class="connected" role="img" title={t('Connected')} aria-label={t('Connected')}
          ></span>
        {/if}
      </button>
    </li>
  {/each}
{/if}

<style>
  .group {
    padding: var(--space-1) var(--row-pad);
    color: var(--muted);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
  }

  .agent {
    width: 100%;
  }

  .orden-row-label {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .name,
  .asking {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .asking {
    color: var(--accent);
    font-size: var(--text-xs);
  }

  .asks {
    flex: none;
    min-width: 15px;
    height: 15px;
    padding: 0 4px;
    border-radius: 99px;
    background: var(--accent);
    color: var(--accent-ink);
    font-size: var(--text-xs);
    font-weight: var(--weight-strong);
    line-height: 15px;
    text-align: center;
  }

  .connected {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--success);
  }
</style>

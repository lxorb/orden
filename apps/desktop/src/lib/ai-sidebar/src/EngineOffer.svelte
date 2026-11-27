<script lang="ts">
  import Download from 'lucide/dist/esm/icons/download.mjs'
  import { engine, stoppedLine } from '../../opencode-client/src/api'
  import { Glyph } from '../../ui-controls/src/api'

  const size = $derived(Math.round((engine.status?.bytes ?? 0) / 1e6))
  const share = $derived(Math.floor((100 * (engine.received ?? 0)) / Math.max(1, engine.status?.bytes ?? 1)))
  $effect(() => {
    if (!engine.status) void engine.look()
  })
</script>

<div class="offer">
  <span class="mark"><Glyph node={Download} /></span>
  <p class="words">OpenCode ({size} MB) must be downloaded to use the AI integration.</p>
  {#if engine.going}
    <div class="bar">
      <div class="orden-meter" role="progressbar" aria-valuenow={share} aria-valuemin={0} aria-valuemax={100}>
        <div class="orden-meter-fill" style:width="{share}%"></div>
      </div>
    </div>
    <button class="link" onclick={() => void engine.cancel()}>Cancel</button>
  {:else}
    <button class="orden-button" onclick={() => void engine.download()}>Download</button>
    {#if engine.trouble}<p class="stopped">{stoppedLine(engine.trouble)}</p>{/if}
  {/if}
</div>

<style>
  .offer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    margin: auto;
    padding: var(--space-6) var(--space-4);
    max-width: 16rem;
    text-align: center;
  }
  .mark {
    --mark: 22px;
    color: var(--muted);
  }
  .words,
  .stopped {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-row);
    color: var(--muted-strong);
  }
  .stopped {
    max-width: 100%;
    overflow: hidden;
    color: var(--danger);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .bar {
    width: 100%;
  }
  .link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
  }
</style>

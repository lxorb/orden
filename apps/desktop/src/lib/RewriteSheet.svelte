<script lang="ts">
  import { rewriting } from './ai/rewriting.svelte'
  import { languageNames, VERBS } from './ai/rewrite'
  import { diffCount, lineDiff, trimmed } from './diff'
  import { dur, fade } from './platform/src/api'
  import { scrollbar } from './ui-kit/src/api'
  import { Select } from './ui-controls/src/api'
  import { Sheet } from './ui-controls/src/api'
  import { viewport } from './ui-kit/src/api'

  const answer = $derived(rewriting.after.trim())
  const difference = $derived(answer ? lineDiff(rewriting.before, answer) : [])
  const changes = $derived(trimmed(difference))
  const counted = $derived(diffCount(difference))
</script>

<Sheet open={rewriting.open} title="Rewrite" onclose={() => rewriting.close()}>
  <div class="card">
    <div class="verbs">
      {#each VERBS as verb (verb.id)}
        <button
          class="orden-chip"
          class:is-on={rewriting.verb === verb.id}
          onclick={() => rewriting.run(verb.id)}
        >
          {verb.label}
        </button>
      {/each}
    </div>

    {#if rewriting.verb === 'translate'}
      <div class="row" transition:fade={{ duration: dur(130) }}>
        <span class="name">Language</span>
        <div class="pick">
          <Select
            value={rewriting.language}
            options={languageNames().map((one) => ({ value: one.id, label: one.name }))}
            onchange={(value: string) => {
              rewriting.language = value
              rewriting.run('translate')
            }}
            label="Language"
            plain={viewport.touch}
          />
        </div>
      </div>
    {/if}
  </div>

  {#if rewriting.trouble}
    <p class="wrong">{rewriting.trouble}</p>
  {/if}

  {#if changes.length}
    <p class="hint">
      <ins>+{counted.added}</ins>
      <del>-{counted.removed}</del>
    </p>
    <div class="diff" use:scrollbar>
      {#each changes as row, at (at)}
        <div class="change {row.change}">{row.text || ' '}</div>
      {/each}
    </div>
  {:else if rewriting.running}
    <p class="hint">Rewriting…</p>
  {:else if rewriting.verb && !rewriting.trouble}
    <p class="hint">No changes</p>
  {/if}

  {#if answer}
    <div class="answers">
      <button class="orden-button is-quiet" onclick={() => rewriting.close()}>Discard</button>
      <button class="orden-button" disabled={rewriting.running} onclick={() => rewriting.accept()}>
        Replace
      </button>
    </div>
  {/if}
</Sheet>

<style>
  .verbs {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    width: 100%;
    padding: var(--space-1) 0;
  }

  .pick {
    flex: none;
    width: 11rem;
  }

  .diff {
    max-height: 34vh;
    overflow: auto;
    margin: 0 var(--space-2);
    padding: var(--space-2) 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    line-height: 1.6;
  }

  .change {
    padding: 0 var(--space-3);
    color: var(--muted-strong);
    white-space: pre-wrap;
  }

  .change.added {
    background: color-mix(in srgb, var(--success) 14%, transparent);
    color: var(--text-strong);
  }

  .change.removed {
    background: color-mix(in srgb, var(--danger) 14%, transparent);
    color: var(--text-strong);
  }

  ins,
  del {
    margin-inline-end: var(--space-2);
    text-decoration: none;
  }

  ins {
    color: var(--success);
  }

  del {
    color: var(--danger);
  }

  .answers {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: 0 var(--space-2);
  }
</style>

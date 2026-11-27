<script lang="ts">
  import { Mascot } from '../../mascot/src/api'
  import { keep, openExternal, storedText } from '../../platform/src/api'
  import { Sheet } from '../../ui-controls/src/api'
  import { RELEASES_URL } from './links'
  import { faceAfter, type News } from './news'

  const { version, since, bugs, added, updates, onclose }: News & { onclose: () => void } = $props()
  const FACE_KEY = 'orden:news-face'
  const mood = faceAfter(storedText(FACE_KEY))
  keep(FACE_KEY, mood)
  const SHOWN = 6
  const full = $derived(updates === 1 ? `${RELEASES_URL}/tag/v${version}` : RELEASES_URL)
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)
</script>

<Sheet open title="What's new in Orden {version}" width="42rem" {onclose}>
  <div class="hero">
    <div class="face"><Mascot {mood} size={36} endless /></div>
    <p class="lead">Since you've been gone, here's what we did for you</p>
  </div>

  <div class="sums">
    <div class="sum is-lead">
      <strong>{bugs}</strong>
      <span>{plural(bugs, 'bug', 'bugs')} fixed</span>
    </div>
    <div class="sum">
      <strong>{added.length}</strong>
      <span>{plural(added.length, 'thing', 'things')} new</span>
    </div>
    <div class="sum">
      <strong>{updates}</strong>
      <span>{plural(updates, 'update', 'updates')} since {since}</span>
    </div>
  </div>

  {#if added.length > 0}
    <h3>New</h3>
    <ul>
      {#each added.slice(0, SHOWN) as one, at (at)}
        <li>{one}</li>
      {/each}
    </ul>
    {#if added.length > SHOWN}
      <p class="more">And {added.length - SHOWN} more in the full list.</p>
    {/if}
  {/if}

  {#snippet foot()}
    <button class="orden-button is-quiet" onclick={() => void openExternal(full)}>See the full list</button>
    <button class="orden-button" onclick={onclose}>Done</button>
  {/snippet}
</Sheet>

<style>
  .hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-4) 0 var(--space-3);
  }
  .lead {
    margin: 0;
    max-width: 22em;
    text-align: center;
    font-size: 1.375rem;
    line-height: 1.3;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    text-wrap: balance;
  }
  .face {
    display: flex;
    justify-content: center;
    min-height: 3.5rem;
    align-items: center;
  }
  .sums {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: var(--space-2);
    margin: var(--space-2) 0 var(--space-4);
  }
  .sum {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }
  .sum strong {
    font-size: 1.75rem;
    line-height: 1.1;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    font-variant-numeric: tabular-nums;
  }
  .sum.is-lead strong {
    color: var(--accent);
  }
  .sum span {
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }
  h3 {
    margin: 0 0 var(--space-2);
    font-size: var(--text-sm);
    color: var(--muted-strong);
  }
  ul {
    margin: 0;
    padding-inline-start: 1.2em;
    font-size: var(--text-row);
    line-height: 1.55;
    color: var(--text);
    overflow-wrap: anywhere;
  }
  li {
    margin-bottom: var(--space-1);
  }
  .more {
    margin: var(--space-2) 0 0;
    font-size: var(--text-sm);
    color: var(--muted);
  }
</style>

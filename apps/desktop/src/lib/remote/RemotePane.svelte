<script lang="ts">
  import Facts from '../Facts.svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { dropOver } from '../drag-paths'
  import { prompt } from '../prompt.svelte'
  import { arrive } from '../slide'
  import { invoke } from '../platform/src/api'
  import { viewport } from '../viewport.svelte'
  import HostDetail from './HostDetail.svelte'
  import HostMark from './HostMark.svelte'
  import { destinationOf, moved } from './hosts'
  import { remote } from './hosts.svelte'

  $effect(() => {
    void remote.refresh()
  })

  let chosen = $state<string | null>(null)
  const host = $derived(chosen === null ? null : (remote.byId(chosen) ?? null))
  $effect(() => closeOnBack(host !== null, () => (chosen = null)))

  let problem = $state('')

  async function add() {
    problem = ''
    const typed = await prompt.ask({
      title: 'Add host',
      placeholder: 'user@host:22',
      confirmLabel: 'Add',
    })
    if (typed === null) return

    const wanted = destinationOf(typed)
    if (!wanted) {
      problem = 'Not an address'
      return
    }
    const made = await remote.make(wanted)
    if (made) chosen = made.id
  }

  const move = (from: number, to: number) =>
    void remote.keep((kept) => moved(kept, remote.hosts, from, to))

  async function openConfig() {
    problem = ''
    await invoke('remote_config_open').catch((error: unknown) => {
      problem = String(error)
    })
  }

  let dragging = $state<number | null>(null)
  let dropAt = $state<number | null>(null)

  function over(event: DragEvent, at: number) {
    if (dragging === null || dragging === at) return
    event.preventDefault()
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move'
    dropAt = at
  }

  function dropped(event: DragEvent, at: number) {
    event.preventDefault()
    if (dragging !== null) move(dragging, at)
    dragging = null
    dropAt = null
  }
</script>

<div class="remote">
  {#key host?.id}
    <div class="page" in:arrive>
      {#if host}
        <HostDetail {host} onback={() => (chosen = null)} />
      {:else}
        <div class="card">
          {#each remote.hosts as one, at (one.id)}
            {@const about = [one.detail, one.group].filter(Boolean)}
            <div
              class="orden-setting row"
              class:landing={dropAt === at}
              role="group"
              aria-label={one.name}
              draggable={!viewport.touch}
              ondragstart={(event) => {
                event.dataTransfer?.setData('text/plain', one.id)
                dragging = at
              }}
              use:dropOver={(event) => over(event, at)}
              ondragleave={() => (dropAt = null)}
              ondragend={() => {
                dragging = null
                dropAt = null
              }}
              ondrop={(event) => dropped(event, at)}
            >
              <button class="open" onclick={() => (chosen = one.id)}>
                <HostMark colour={one.colour} />
                <span class="name">
                  {one.name}
                  {#if about.length}<small><Facts parts={about} /></small>{/if}
                </span>
              </button>
              <button
                class="orden-glyph"
                disabled={at === 0}
                title="Move up"
                aria-label="Move up"
                onclick={() => move(at, at - 1)}
              >
                <svg viewBox="0 0 16 16"><path d="M4.5 9.5L8 6l3.5 3.5" /></svg>
              </button>
              <button
                class="orden-glyph"
                disabled={at === remote.hosts.length - 1}
                title="Move down"
                aria-label="Move down"
                onclick={() => move(at, at + 1)}
              >
                <svg viewBox="0 0 16 16"><path d="M4.5 6.5L8 10l3.5-3.5" /></svg>
              </button>
            </div>
          {/each}
          <button class="orden-setting row add" onclick={() => void add()}>
            <span class="orden-setting-mark plus" aria-hidden="true"
              ><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg></span
            >
            <span class="name">Add host</span>
          </button>
        </div>

        {#if remote.file}
          <button class="link" onclick={() => void openConfig()}>Open config</button>
        {/if}
      {/if}

      {#if problem}
        <p class="hint bad">{problem}</p>
      {/if}
    </div>
  {/key}
</div>

<style>
  .remote,
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .remote :global(h3) {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .remote :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .remote :global(.orden-setting .name) {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .remote :global(.orden-setting .name small) {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .remote :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .remote :global(.hint.bad) {
    color: var(--danger);
  }

  .open {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    cursor: default;
  }

  @media (hover: hover) {
    .open:hover,
    .add:hover {
      color: var(--text-strong);
    }
  }

  .plus svg {
    width: 14px;
    height: 14px;
    fill: none;
    stroke: currentColor;
    stroke-width: 1.6;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .row.landing {
    box-shadow: inset 0 2px 0 var(--accent);
  }

  .link {
    align-self: flex-start;
    padding: 0;
    border: none;
    background: none;
    color: var(--accent);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    cursor: default;
    transition: color var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .link:hover {
      color: var(--accent-hover);
    }
  }
</style>

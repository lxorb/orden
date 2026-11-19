<script lang="ts">
  import { arrive, closeOnBack } from '../../ui-kit/src/api'
  import { Sheet, Switch } from '../../ui-controls/src/api'
  import McpImport from './McpImport.svelte'
  import { type Found, scanMcp, said, type ServerView, stateWords } from './mcp'
  import ServerDetail from './ServerDetail.svelte'
  import ServerForm from './ServerForm.svelte'
  import { mcp } from './servers.svelte'

  const { ondetail }: { ondetail?: (open: boolean) => void } = $props()
  type Page = { at: 'list' } | { at: 'server'; id: string } | { at: 'form'; id: string | null }
  let page = $state<Page>({ at: 'list' })
  const view = $derived(page.at === 'list' || page.id === null ? null : mcp.byId(page.id))
  const back = () => (page = page.at === 'form' && page.id !== null ? { at: 'server', id: page.id } : { at: 'list' })
  $effect(() => mcp.open())
  $effect(() => closeOnBack(page.at !== 'list', back))
  $effect(() => {
    ondetail?.(page.at !== 'list')
  })
  $effect(() => {
    if (page.at === 'server' && !view && mcp.read) page = { at: 'list' }
  })
  let importing = $state(false)
  let found = $state<Found[] | null>(null)
  let scanProblem = $state('')
  async function scan() {
    importing = true
    found = null
    scanProblem = ''
    try {
      found = await scanMcp()
    } catch (error) {
      scanProblem = said(error)
      found = []
    }
  }
</script>

<div class="mcp">
  {#key page.at === 'list' ? 'list' : `${page.at}:${page.id}`}
    <div class="page" in:arrive>
      {#if page.at === 'form'}
        <ServerForm {view} onback={back} onsaved={(made: ServerView) => (page = { at: 'server', id: made.id })} />
      {:else if page.at === 'server' && view}
        <ServerDetail {view} onback={back} onedit={() => (page = { at: 'form', id: view.id })} />
      {:else}
        <p class="hint">
          Tools from outside MCP servers that Orden's AI can use in chat. Each tool asks first, runs freely or stays
          off, as you choose.
        </p>
        <div class="card">
          {#each mcp.list as one (one.id)}
            <div
              class="orden-setting pressable row"
              role="button"
              tabindex="0"
              aria-label={one.name}
              onclick={() => (page = { at: 'server', id: one.id })}
              onkeydown={(event) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                page = { at: 'server', id: one.id }
              }}
            >
              <span class="name">
                {one.name}
                <small class:bad={one.state === 'failed'}>{stateWords(one)}</small>
              </span>
              <Switch on={one.on} label={`Use ${one.name}`} onchange={(on: boolean) => void mcp.switch(one.id, on)} />
            </div>
          {/each}
          <button class="orden-setting row add" onclick={() => (page = { at: 'form', id: null })}>
            <span class="orden-setting-mark plus" aria-hidden="true"
              ><svg viewBox="0 0 16 16"><path d="M8 3.5v9M3.5 8h9" /></svg></span
            >
            <span class="name">Add server</span>
          </button>
          <button class="orden-setting row add" onclick={() => void scan()}>
            <span class="orden-setting-mark plus" aria-hidden="true"
              ><svg viewBox="0 0 16 16"><path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10" /></svg></span
            >
            <span class="name">Import from other apps</span>
          </button>
        </div>
      {/if}
      {#if mcp.problem}
        <p class="hint bad">{mcp.problem}</p>
      {/if}
    </div>
  {/key}
</div>

<Sheet open={importing} title="Import from other apps" onclose={() => (importing = false)}>
  {#if found === null}
    <p class="hint">Looking at other apps</p>
  {:else if found.length}
    <McpImport
      {found}
      onimported={() => {
        importing = false
        void mcp.load()
      }}
    />
  {:else}
    <p class="hint" class:bad={!!scanProblem}>{scanProblem || 'No new servers in other apps.'}</p>
  {/if}
</Sheet>

<style>
  .mcp,
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }
  .mcp :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
  }
  .mcp :global(.orden-setting .name) {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
  }
  .mcp :global(.orden-setting .name small) {
    font-size: var(--text-xs);
    color: var(--muted);
    overflow-wrap: anywhere;
  }
  .mcp :global(.hint),
  .hint {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }
  .mcp :global(.bad),
  .hint.bad {
    color: var(--danger);
  }
  @media (hover: hover) {
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
</style>

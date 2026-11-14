<script lang="ts">
  import { localDate } from '../platform/src/api'
  import Facts from '../Facts.svelte'
  import { onMount } from 'svelte'
  import { cubicOut } from 'svelte/easing'
  import { account } from '../accounts/src/api'
  import { AgentMark, AgentsPane, loadAgentDetail, reach, tauriCrate } from '../agents/src/api'
  import { closeOnBack } from '../ui-kit/src/api'
  import { connectors } from '../connectors.svelte'
  import { dur, slide } from '../platform/src/api'
  import { settings } from '../settings.svelte'
  import { arrive, segmented } from '../ui-kit/src/api'
  import { keep, storedText } from '../platform/src/api'
  import { invoke, isDesktop, platform } from '../platform/src/api'
  import AccountSteps from './AccountSteps.svelte'
  import { type Choice, choices, shownFirst, viaAccount } from './choices'
  import LocalSteps from './LocalSteps.svelte'
  import { Hint } from '../ui-controls/src/api'
  import { Switch } from '../ui-controls/src/api'

  const { ondetail }: { ondetail?: (open: boolean) => void } = $props()

  const CHOICE_KEY = 'orden:access-choice'

  const local = !__EVEN_PLUGIN__ && reach.offered
  const pane = local ? new AgentsPane(reach.standIn ?? tauriCrate) : null

  $effect(() => {
    if (!pane) return
    void pane.open()
    return () => {
      pane.close()
    }
  })

  $effect(() => {
    if (!account.user) return
    return connectors.watch()
  })

  let chosen = $state<string | null>(null)
  const agent = $derived(pane?.grants.find((one) => one.id === chosen) ?? null)
  $effect(() => closeOnBack(agent !== null, () => (chosen = null)))
  $effect(() => {
    ondetail?.(agent !== null)
  })

  const listed = $derived(
    pane
      ? [...pane.grants].sort(
          (a, b) =>
            (pane.last.get(b.id) ?? 0) - (pane.last.get(a.id) ?? 0) || a.created - b.created,
        )
      : [],
  )

  const offered = $derived(choices(local, !!account.user))
  let picked = $state<Choice | null>(null)
  const choice = $derived(picked ?? shownFirst(offered, storedText(CHOICE_KEY)))

  const LABELS: Record<Choice, () => string> = {
    'claude-code': () => 'Claude Code',
    codex: () => 'Codex',
    antigravity: () => 'Antigravity',
    claude: () => 'Claude',
    chatgpt: () => 'ChatGPT',
    other: () => 'Other',
  }

  function pick(one: Choice) {
    picked = one
    keep(CHOICE_KEY, one)
  }

  const when = (at: number | null | undefined) =>
    at === null || at === undefined
      ? 'Not used yet.'
      : `Last used ${localDate(at, { dateStyle: 'short', timeStyle: 'medium' })}.`

  const access = (readOnly: boolean) =>
    readOnly ? 'Reads your notes.' : 'Reads and writes your notes.'

  const anything = $derived(
    listed.length > 0 ||
      (!!account.user && (connectors.clients.length > 0 || !!connectors.token?.exists)),
  )

  let root = $state<HTMLElement>()

  let enrolled = $state<boolean | null>(null)

  onMount(() => {
    if (!isDesktop) return
    void invoke<unknown>('ai_cli_enroll_read').then(
      (said) => {
        const { offered, on } = (said ?? {}) as { offered?: unknown; on?: unknown }
        enrolled = offered === true ? on !== false : null
      },
      () => undefined,
    )
  })

  let shortcuts = $state(false)

  onMount(() => {
    if (!isDesktop || platform() !== 'macos') return
    void invoke<boolean>('shortcuts_offered').then(
      (said) => (shortcuts = said),
      () => undefined,
    )
  })

  function enroll() {
    if (enrolled === null) return
    enrolled = !enrolled
    void invoke('ai_cli_enroll_write', { on: enrolled }).catch(() => undefined)
  }

  onMount(() => {
    if (settings.at !== 'access') return
    settings.at = null
    requestAnimationFrame(() => root?.scrollIntoView({ block: 'start' }))
  })
</script>

<div class="agents" bind:this={root}>
  {#key agent?.id}
    <div class="page" in:arrive>
      {#if agent && pane}
        {#await loadAgentDetail() then { default: AgentDetail }}
          <AgentDetail {pane} grant={agent} onback={() => (chosen = null)} />
        {/await}
      {:else}
        <h3>Access</h3>
        {#if anything}
          <div class="card">
            {#each listed as grant (grant.id)}
              <button class="orden-setting agent" onclick={() => (chosen = grant.id)}>
                <AgentMark name={grant.name} />
                <span class="name">
                  {grant.name}
                  <small>
                    <Facts
                      parts={[
                        grant.client !== grant.name && grant.client,
                        when(pane?.last.get(grant.id)),
                      ]}
                    />
                  </small>
                </span>
                <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"
                  ><path d="M6 3l5 5-5 5" /></svg
                >
              </button>
            {/each}

            {#if account.user}
              {#each connectors.clients as one (one.id)}
                <div
                  class="orden-setting connected"
                  transition:slide={{ duration: dur(180), easing: cubicOut }}
                >
                  <AgentMark name={one.name} />
                  <span class="name">
                    {one.name}
                    <small>{access(one.readOnly)} {when(one.lastUsedAt)}</small>
                  </span>
                  <button class="orden-chip is-quiet" onclick={() => connectors.disconnect(one.id)}>
                    Disconnect
                  </button>
                </div>
              {/each}

              {#if connectors.token?.exists}
                <div
                  class="orden-setting connected"
                  transition:slide={{ duration: dur(180), easing: cubicOut }}
                >
                  <AgentMark name="Pasted token" />
                  <span class="name">
                    Pasted token
                    <small
                      >{access(connectors.token.readOnly)}
                      {when(connectors.token.lastUsedAt)}</small
                    >
                  </span>
                  <button
                    class="orden-chip is-quiet"
                    disabled={connectors.busy}
                    onclick={() => connectors.revokeToken()}
                  >
                    Revoke
                  </button>
                </div>
              {/if}
            {/if}
          </div>
        {/if}

        {#if enrolled !== null}
          <div class="card">
            <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
            <div class="orden-setting pressable" onclick={enroll}>
              <span class="name"
                ><span class="orden-named"
                  >Agents on this computer connect on their own<Hint
                    text="Adds Orden to the AI agent programs on this computer, so they reach your notes with nothing to set up."
                  /></span
                ></span
              >
              <Switch
                on={enrolled}
                label="Agents on this computer connect on their own"
                onchange={enroll}
              />
            </div>
          </div>
        {/if}

        {#if shortcuts}
          <div class="card">
            <button
              class="orden-setting agent"
              onclick={() => void invoke('open_shortcuts').catch(() => undefined)}
            >
              <AgentMark name="Apple Shortcuts" />
              <span class="name">
                Apple Shortcuts
                <small>Add task</small>
              </span>
              <svg class="chevron" viewBox="0 0 16 16" aria-hidden="true"
                ><path d="M5 11l6-6M6 5h5v5" /></svg
              >
            </button>
          </div>
        {/if}

        {#if choice && (!local || pane?.ready)}
          <h3>{anything ? 'Connect another' : 'Connect'}</h3>
          <div class="orden-segmented" role="tablist" use:segmented>
            {#each offered as one (one)}
              <button
                role="tab"
                class:on={choice === one}
                aria-selected={choice === one}
                onclick={() => pick(one)}
              >
                {LABELS[one]()}
              </button>
            {/each}
          </div>

          {#if pane && (choice === 'claude-code' || choice === 'codex' || choice === 'antigravity' || choice === 'other')}
            <LocalSteps {pane} client={choice} />
          {/if}
          {#if account.user && (viaAccount(choice) || choice === 'other')}
            <AccountSteps client={viaAccount(choice) ? choice : 'other'} />
          {/if}
        {/if}
      {/if}

      {#if pane?.error}
        <p class="hint bad">{pane.error}</p>
      {/if}
    </div>
  {/key}
</div>

<style>
  .agents,
  .page {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    width: 100%;
  }

  .agents {
    margin-top: var(--space-4);
  }

  .agents :global(h3) {
    margin: var(--space-3) 0 calc(-1 * var(--space-2));
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: var(--weight-strong);
    color: var(--muted-strong);
  }

  .agents :global(.card) {
    display: flex;
    flex-direction: column;
    width: 100%;
  }

  .agents :global(.orden-setting .name) {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .agents :global(.orden-setting .name small) {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .agents :global(.chevron) {
    flex: none;
    width: 14px;
    height: 14px;
    fill: none;
    stroke: var(--muted);
    stroke-width: 1.5;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .agents :global(.hint) {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--muted);
    line-height: 1.5;
  }

  .agents :global(.hint.bad) {
    color: var(--danger);
  }

  @media (hover: hover) {
    .agents :global(button.orden-setting:hover),
    .agents :global(.orden-setting.pressable:hover) {
      color: var(--text-strong);
    }
  }

  .agents :global(button.orden-setting:focus-visible),
  .agents :global(.orden-setting.pressable:focus-visible) {
    outline-offset: 2px;
    border-radius: var(--radius-sm);
  }
</style>

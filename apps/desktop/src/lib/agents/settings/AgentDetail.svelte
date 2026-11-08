<script lang="ts">
  import Facts from '../../Facts.svelte'
  import TriangleAlert from 'lucide/dist/esm/icons/triangle-alert.mjs'
  import Cross from '../../Cross.svelte'
  import { i18n, t } from '../../i18n.svelte'
  import { prompt } from '../../prompt.svelte'
  import Select from '../../Select.svelte'
  import { workspace } from '../../workspace.svelte'
  import type { Grant, Scope } from '../verbs'
  import AgentLog from './AgentLog.svelte'
  import AgentMark from './AgentMark.svelte'
  import {
    LIMITS,
    LIMIT_NAMES,
    type Limit,
    SCOPE_GROUPS,
    reaches,
    sidebars,
    sitesOf,
    trifecta,
    withEverySpace,
    withLimit,
    withListed,
    withName,
    withoutAlways,
    withScope,
    withSite,
    withSpace,
  } from './grant'
  import type { AgentsPane } from './pane.svelte'
  import { registrable, typedSite } from './sites'
  import Words from './Words.svelte'
  import {
    CATEGORY_WORDS,
    GROUP_WORDS,
    LIMIT_WORDS,
    limitValue,
    RULE_WORDS,
    SCOPE_WORDS,
  } from './words'

  const { pane, grant, onback }: { pane: AgentsPane; grant: Grant; onback: () => void } = $props()

  const change = (edit: (one: Grant) => Grant) => void pane.change(grant.id, edit)

  const spaceNames = $derived(workspace.spaces.map((one) => one.name))
  const listedSpaces = $derived(
    grant.spaces === 'all'
      ? spaceNames
      : [...spaceNames, ...grant.spaces.filter((one) => !spaceNames.includes(one))],
  )

  const sites = $derived(sitesOf(grant))

  let chatNames = $state.raw<Record<string, string>>({})
  $effect(() => {
    if (!sites.some((one) => one.site.startsWith('chat:'))) return
    const store = __EVEN_PLUGIN__ ? null : import('../../chats/store.svelte')
    void store?.then(({ chats }) => {
      chatNames = Object.fromEntries(
        chats.list.map((one) => [`chat:${one.id}`, `#${one.name ?? one.id}`]),
      )
    })
  })
  const ruleChoices = $derived(
    (['allow', 'deny', 'agent-store'] as const).map((value) => ({
      value,
      label: RULE_WORDS[value](),
    })),
  )

  const siteTyped = async (typed: string) => typedSite(typed, await registrable())

  const programTyped = (typed: string) => Promise.resolve(typed.trim() || null)

  const listing = (list: 'scripts' | 'programs', on: boolean) => (word: string) => {
    change((one) => withListed(one, list, word, on))
  }

  function addSite(site: string) {
    change((one) => withSite(one, site, one.sites[site] ?? 'deny'))
  }

  function toggleScope(scope: Scope) {
    change((one) => withScope(one, scope, !one.scopes.includes(scope)))
  }

  async function remove() {
    const sure = await prompt.confirm({
      title: t('Remove {name}?', { name: grant.name }),
      detail: t('Its token stops working.'),
      confirmLabel: t('Remove'),
      danger: true,
    })
    if (!sure) return
    onback()
    await pane.remove(grant.id)
  }

  function pressed(event: KeyboardEvent, then: () => void) {
    if (event.key !== ' ' && event.key !== 'Enter') return
    event.preventDefault()
    then()
  }

  let moving = $state<{ limit: Limit; value: number } | null>(null)

  const limitOf = (limit: Limit) => (moving?.limit === limit ? moving.value : grant.limits[limit])

  const fraction = (limit: Limit) =>
    ((limitOf(limit) - LIMITS[limit].min) / (LIMITS[limit].max - LIMITS[limit].min)) * 100
</script>

{#snippet toggle(label: string, on: boolean, flip: () => void)}
  <div
    class="orden-setting pressable"
    role="switch"
    tabindex="0"
    aria-checked={on}
    onclick={flip}
    onkeydown={(event) => {
      pressed(event, flip)
    }}
  >
    <span class="name">{label}</span>
    <span class="orden-switch" class:on aria-hidden="true"></span>
  </div>
{/snippet}

<header class="who">
  <button class="orden-glyph back" aria-label={t('Back')} title={t('Back')} onclick={onback}>
    <svg class="orden-mirror" viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg
    >
  </button>
  <AgentMark name={grant.name} />
  <span class="name">
    <input
      class="title"
      value={grant.name}
      aria-label={t('Name')}
      spellcheck="false"
      autocomplete="off"
      onchange={(event) => {
        const name = event.currentTarget.value
        if (!name.trim()) event.currentTarget.value = grant.name
        else change((one) => withName(one, name))
      }}
    />
    <small>
      <Facts
        parts={[
          grant.client !== grant.name && grant.client,
          t('Added {date}', { date: i18n.when(grant.created, { dateStyle: 'medium' }) }),
        ]}
      />
    </small>
  </span>
</header>

{#if trifecta(grant)}
  <p class="trifecta">
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {#each TriangleAlert as [tag, attrs], index (index)}
        <svelte:element this={tag} {...attrs} />
      {/each}
    </svg>
    {t(
      'It reads your notes and browses signed in as you, so a page could try to make it send them out.',
    )}
  </p>
{/if}

<h3>{t('Activity')}</h3>
<AgentLog {pane} {grant} />

{#if !sidebars(grant)}
  <p class="connected">
    {t(
      'It connects over MCP and manages its own permissions there: Orden asks it nothing. Your spaces, blocked sites and limits below still hold.',
    )}
  </p>
{/if}

{#each sidebars(grant) ? SCOPE_GROUPS : [] as group (group.id)}
  <h3>{GROUP_WORDS[group.id]()}</h3>
  <div class="card">
    {#each group.scopes as scope (scope)}
      {@render toggle(SCOPE_WORDS[scope](), grant.scopes.includes(scope), () => {
        toggleScope(scope)
      })}
    {/each}
    {#if group.id === 'scripts' && grant.scopes.includes('browser.script')}
      <Words
        words={grant.scripts}
        placeholder={t('Add a site')}
        parse={siteTyped}
        onadd={listing('scripts', true)}
        onremove={listing('scripts', false)}
      />
    {/if}
    {#if group.id === 'terminal' && grant.scopes.includes('terminal')}
      <Words
        words={grant.programs}
        placeholder={t('Add a program')}
        hint={t(
          'A program on this list runs without asking, and can do anything that program can do.',
        )}
        parse={programTyped}
        onadd={listing('programs', true)}
        onremove={listing('programs', false)}
      />
    {/if}
  </div>
{/each}

<h3>{t('Spaces')}</h3>
<div class="card">
  {@render toggle(t('Every space'), grant.spaces === 'all', () => {
    change((one) => withEverySpace(one, one.spaces !== 'all', spaceNames))
  })}
  {#if grant.spaces !== 'all'}
    {#each listedSpaces as space (space)}
      {@render toggle(space, reaches(grant, space), () => {
        change((one) => withSpace(one, space, !reaches(one, space)))
      })}
    {/each}
  {/if}
</div>

<h3>{t('Sites')}</h3>
<div class="card">
  {#each sites as { site, rule, always } (site)}
    <div class="orden-setting site">
      <span class="name">
        <span class="what" dir="auto">{chatNames[site] ?? site}</span>
        {#if always.length}
          <span class="always">
            {#each always as category (category)}
              <button
                class="orden-tag"
                title={t('Remove')}
                onclick={() => {
                  change((one) => withoutAlways(one, site, category))
                }}
              >
                {CATEGORY_WORDS[category]()}<Cross small />
              </button>
            {/each}
          </span>
        {/if}
      </span>
      {#if rule}
        <div class="orden-setting-value">
          <Select
            value={rule}
            options={ruleChoices}
            label={site}
            onchange={(value: string) => {
              const chosen = ruleChoices.find((one) => one.value === value)?.value
              if (chosen) change((one) => withSite(one, site, chosen))
            }}
          />
        </div>
        <button
          class="orden-glyph is-danger"
          aria-label={t('Remove')}
          title={t('Remove')}
          onclick={() => {
            change((one) => withSite(one, site, null))
          }}
        >
          <Cross />
        </button>
      {/if}
    </div>
  {/each}
  <Words
    words={[]}
    placeholder={t('Add a site')}
    parse={siteTyped}
    onadd={addSite}
    onremove={() => undefined}
  />
</div>

<h3>{t('Limits')}</h3>
<div class="card">
  {#each LIMIT_NAMES as limit (limit)}
    <div class="orden-setting sliding">
      <span class="name">{LIMIT_WORDS[limit]()}</span>
      <span class="value">{limitValue(limit, limitOf(limit))}</span>
      <input
        class="slider orden-slider"
        type="range"
        min={LIMITS[limit].min}
        max={LIMITS[limit].max}
        step={LIMITS[limit].step}
        value={limitOf(limit)}
        aria-label={LIMIT_WORDS[limit]()}
        style:--fill="{fraction(limit)}%"
        oninput={(event) => {
          moving = { limit, value: Number(event.currentTarget.value) }
        }}
        onchange={(event) => {
          const value = Number(event.currentTarget.value)
          moving = null
          change((one) => withLimit(one, limit, value))
        }}
      />
    </div>
  {/each}
</div>

<div class="card">
  <button class="orden-action is-danger" onclick={() => void remove()}>{t('Remove')}</button>
</div>

<style>
  .back {
    margin-inline-start: -6px;
  }

  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .who .name {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .who small {
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .title {
    width: 100%;
    margin-inline-start: -7px;
    padding: 2px 6px;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: var(--weight-strong);
    transition:
      border-color var(--dur-fast) var(--ease-out),
      background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .title:hover {
      border-color: var(--line);
    }
  }

  .title:focus {
    background: var(--bg);
  }

  .connected {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted);
  }

  .trifecta {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--callout-warning);
  }

  .trifecta svg {
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
    margin-block-start: 1px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .always {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin-block-start: 2px;
  }

  .value {
    flex: none;
    width: 3.5rem;
    text-align: end;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .slider {
    width: 11rem;
  }

  [dir='auto'] {
    text-align: -webkit-match-parent;
    text-align: match-parent;
  }
</style>

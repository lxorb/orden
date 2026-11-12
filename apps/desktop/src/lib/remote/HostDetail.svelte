<script lang="ts">
  import { prompt } from '../prompt.svelte'
  import Select from '../Select.svelte'
  import Swatches from '../Swatches.svelte'
  import Switch from '../Switch.svelte'
  import { invoke } from '../tauri'
  import HostMark from './HostMark.svelte'
  import {
    type About,
    type Change,
    COLOURS,
    destinationOf,
    groupsOf,
    type Host,
    said,
    withAbout,
    withOwn,
    withoutOwn,
  } from './hosts'
  import { remote } from './hosts.svelte'

  const { host, onback }: { host: Host; onback: () => void } = $props()

  const about = (change: Change<About>) =>
    void remote.keep((kept) => withAbout(kept, host.id, change))

  const NEW = '\u0000new'

  const groups = $derived(groupsOf(remote.hosts, remote.kept))
  const groupChoices = $derived([
    { value: '', label: 'No group' },
    ...groups.map((group) => ({ value: group, label: group })),
    { value: NEW, label: 'New group' },
  ])

  async function grouped(value: string) {
    if (value !== NEW) {
      about({ group: value || undefined })
      return
    }
    const named = await prompt.ask({ title: 'New group', confirmLabel: 'Add' })
    if (named?.trim()) about({ group: named.trim() })
  }

  const colours = $derived([
    { value: '', label: 'No colour', colour: 'var(--line-strong)' },
    ...COLOURS.map((one) => ({
      value: one,
      label: `Colour ${one}`,
      colour: `var(--canvas-${one})`,
    })),
  ])

  let problem = $state('')

  function placed(typed: string, field: HTMLInputElement) {
    const wanted = destinationOf(typed)
    if (!wanted) {
      problem = 'Not an address'
      field.value = host.detail ?? host.hostname ?? ''
      return
    }
    problem = ''
    void remote.keep((kept) =>
      withOwn(kept, host.id, {
        hostname: wanted.hostname,
        user: wanted.user ?? undefined,
        port: wanted.port ?? undefined,
      }),
    )
  }

  function renamed(typed: string, field: HTMLInputElement) {
    if (!typed.trim()) field.value = host.name
    else void remote.keep((kept) => withOwn(kept, host.id, { name: typed.trim() }))
  }

  async function remove() {
    const sure = await prompt.confirm({ title: host.name, confirmLabel: 'Remove', danger: true })
    if (!sure) return
    onback()
    await remote.keep((kept) => withoutOwn(kept, host.id))
  }
</script>

<header class="who">
  <button class="orden-glyph back" aria-label="Back" title="Back" onclick={onback}>
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3L5 8l5 5" /></svg>
  </button>
  <HostMark colour={host.colour} />
  <span class="name">
    {#if host.own}
      <input
        class="title"
        value={host.name}
        aria-label="Name"
        spellcheck="false"
        autocomplete="off"
        onchange={(event) => renamed(event.currentTarget.value, event.currentTarget)}
      />
    {:else}
      <span class="title">{host.name}</span>
    {/if}
  </span>
</header>

<div class="card">
  <label class="orden-setting">
    <span class="name">Address</span>
    {#if host.own}
      <input
        class="orden-field is-value address"
        value={host.hostname
          ? said({ user: host.user, hostname: host.hostname, port: host.port })
          : ''}
        aria-label="Address"
        spellcheck="false"
        autocomplete="off"
        onchange={(event) => placed(event.currentTarget.value, event.currentTarget)}
      />
    {:else}
      <span class="value">{host.detail ?? host.name}</span>
    {/if}
  </label>

  <div class="orden-setting">
    <span class="name">Colour</span>
    <div class="orden-setting-value is-wrapping">
      <Swatches
        options={colours}
        label="Colour"
        chosen={host.colour ?? ''}
        onchoose={(value: string) => about({ colour: (value || undefined) as About['colour'] })}
      />
    </div>
  </div>

  <div class="orden-setting">
    <span class="name">Group</span>
    <Select
      plain
      label="Group"
      value={host.group ?? ''}
      options={groupChoices}
      onchange={(value: string) => void grouped(value)}
    />
  </div>

  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="orden-setting pressable" onclick={() => about({ pinned: !host.pinned })}>
    <span class="name">Pin</span>
    <Switch on={host.pinned} label="Pin" onchange={(on: boolean) => about({ pinned: on })} />
  </div>
</div>

{#if problem}
  <p class="hint bad">{problem}</p>
{/if}

<div class="card">
  {#if host.own}
    <button class="orden-action is-danger" onclick={() => void remove()}>Remove</button>
  {:else if remote.file}
    <button
      class="orden-action"
      onclick={() => void invoke('remote_config_open').catch(() => undefined)}>Open config</button
    >
  {/if}
</div>

<style>
  .who {
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .who .name {
    flex: 1;
    min-width: 0;
  }

  .back {
    margin-inline-start: -6px;
  }

  .title {
    display: block;
    width: 100%;
    padding: 2px 0;
    border: none;
    border-bottom: 1px solid transparent;
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-head);
    font-weight: var(--weight-strong);
    outline: none;
    transition: border-color var(--dur-fast) var(--ease-out);
  }

  input.title:focus {
    border-bottom-color: var(--accent);
  }

  .address {
    font-family: var(--font-mono);
  }

  .value {
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
</style>

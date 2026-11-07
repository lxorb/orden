<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import FileMark from '../../FileMark.svelte'
  import { t } from '../../i18n.svelte'
  import { dur } from '../../motion'
  import { pages, siteMark } from '../../web-tab/pages.svelte'
  import { workspace } from '../../workspace.svelte'
  import type { Approval } from '../verbs'
  import type { Activity } from './activity.svelte'
  import { hostOf } from './session'

  const { activity, approval }: { activity: Activity; approval: Approval } = $props()

  const chat = $derived(approval.site?.startsWith('chat:') === true)

  const site = $derived(approval.site === undefined || chat ? null : hostOf(approval.site))

  const icon = $derived.by(() => {
    const tab = approval.tab
    const web =
      tab !== undefined && workspace.tabs.some((one) => one.id === tab && one.kind === 'web')
    return siteMark(web ? pages.of(tab).icon : null, approval.site)
  })
  let marked = $state(true)

  let answering = $state(false)

  async function answer(allow: boolean, always = false) {
    if (answering) return
    answering = true
    try {
      await activity.answer(approval, allow, always)
    } finally {
      answering = false
    }
  }

  function goThere() {
    const tab = approval.tab
    if (tab === undefined) return
    if (tab in activity.seen.tabs) void activity.show(tab)
    else activity.goTo(tab)
  }
</script>

<div class="question" transition:fly={{ y: -6, duration: dur(120), easing: cubicOut }}>
  <p class="what">
    {#if chat}
      <FileMark mark="chat" />
    {:else if icon && marked}
      <img class="mark" src={icon} alt="" draggable="false" onerror={() => (marked = false)} />
    {:else}
      <FileMark mark="web" />
    {/if}
    <span class="site">{site ?? activity.nameOf(approval.agent)}</span>
  </p>
  <p class="summary">{approval.summary}</p>

  <div class="rows">
    {#if approval.category === 'takeover'}
      {#if approval.tab !== undefined}
        <button class="orden-button is-quiet" onclick={goThere}>{t('Open')}</button>
      {/if}
      <button class="orden-button" disabled={answering} onclick={() => void answer(true)}>
        {t('Done')}
      </button>
    {:else}
      <button class="orden-button is-quiet" disabled={answering} onclick={() => void answer(false)}>
        {t('Don’t allow')}
      </button>
      <button class="orden-button" disabled={answering} onclick={() => void answer(true)}>
        {t('Allow')}
      </button>
    {/if}
  </div>
  {#if (site !== null || chat) && approval.category !== 'takeover' && approval.category !== 'showing'}
    <button class="always" disabled={answering} onclick={() => void answer(true, true)}>
      {chat ? t('Always in this chat') : t('Always on this site')}
    </button>
  {/if}
</div>

<style>
  .question {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-3);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface-3);
    font-family: var(--font-ui);
  }

  .what {
    margin: 0;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    color: var(--text-strong);
    font-size: var(--text-row);
    font-weight: var(--weight-strong);
  }

  .site {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    unicode-bidi: isolate;
  }

  .mark {
    width: var(--icon-md);
    height: var(--icon-md);
    flex: none;
    border-radius: var(--radius-sm);
  }

  .summary {
    margin: 0;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    overflow-wrap: anywhere;
  }

  .rows {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .always {
    align-self: flex-end;
    padding: var(--space-1) var(--space-2);
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--muted-strong);
    font-family: var(--font-ui);
    font-size: var(--text-xs);
    cursor: default;
    transition: background var(--dur-fast) var(--ease-out);
  }

  @media (hover: hover) {
    .always:hover:not(:disabled) {
      background: var(--surface-hover);
    }
  }

  .always:active:not(:disabled) {
    background: var(--surface-press);
  }
</style>

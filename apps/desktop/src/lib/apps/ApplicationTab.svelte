<script lang="ts">
  /** An application in a pane (docs/apps.md): for now, where it stands - which device it
   *  runs on, whether that device is there, whether it runs, who holds it - with Take
   *  over, Start, Stop and Restart. Its picture comes in a later step of issue 1063. The
   *  session is the tab's and outlives this; see session.svelte.ts. */

  import type { NotStarted } from '@orden/online/apps'
  import { onMount, untrack } from 'svelte'
  import { t } from '../i18n.svelte'
  import { heldLine } from '../online/arrival.svelte'
  import Sweep from '../Sweep.svelte'
  import type { Tab } from '../workspace.svelte'
  import { appSessionOf } from './session.svelte'

  const { tab: shown }: { tab: Tab } = $props()
  const tab = untrack(() => shown)
  const session = appSessionOf(tab)

  let place = $state<HTMLElement>()

  /** The pane's size, its pixel ratio, and a refresh rate until it is measured. */
  function view() {
    const box = place?.getBoundingClientRect()
    return {
      width: Math.max(1, Math.round(box?.width ?? 1)),
      height: Math.max(1, Math.round(box?.height ?? 1)),
      dpr: window.devicePixelRatio || 1,
      hz: 60,
    }
  }

  onMount(() => {
    void session.start(view())
    const watching = new ResizeObserver(() => {
      session.resize(view())
    })
    if (place) watching.observe(place)
    return () => {
      watching.disconnect()
    }
  })

  const status = $derived(session.status)
  const device = $derived(session.hostName || t('another device'))
  const line = $derived.by(() => {
    switch (status.is) {
      case 'reading':
      case 'connecting':
        return t('Connecting…')
      case 'damaged':
        return t('This application’s file is damaged')
      case 'away':
        return t('Waiting for {device}', { device })
      case 'held':
        return heldLine(status.holder)
      case 'here':
        if (status.why) return notStarted(status.why, device)
        if (status.state === 'running') return t('Running on {device}', { device })
        if (status.state === 'starting') return t('Starting on {device}…', { device })
        if (status.state === 'exited' && status.code !== null)
          return t('Exited with code {code}', { code: String(status.code) })
        return t('Not running on {device}', { device })
    }
  })
  /** Why its computer did not start it: Windows and macOS have no display of an
   *  application's own yet (step 8 of issue 1063), Linux needs Xvfb, the reader there
   *  said no to a program by its path, or what the file names is not there. */
  function notStarted(why: NotStarted, device: string): string {
    switch (why) {
      case 'isolation':
        return t('{device} cannot run an application on a display of its own yet.', { device })
      case 'display':
        return t('{device} needs Xvfb to run an application.', { device })
      case 'refused':
        return t('{device} did not allow this program.', { device })
      case 'missing':
        return t('{device} does not have this application.', { device })
      case 'failed':
        return t('It did not start on {device}.', { device })
    }
  }

  const waiting = $derived(
    status.is === 'reading' ||
      status.is === 'connecting' ||
      status.is === 'away' ||
      (status.is === 'here' && status.state === 'starting'),
  )
</script>

<div class="application" data-region="editor" bind:this={place}>
  <div class="status" role="status">
    <p>{line}</p>
    {#if status.is === 'held'}
      <button type="button" class="nib-button" onclick={() => session.take()}
        >{status.holder.taken ? t('Take back') : t('Take over')}</button
      >
    {:else if status.is === 'here' && status.state === 'running'}
      <p class="quiet">{t('Its picture is not shown here yet.')}</p>
      <div class="row">
        <button type="button" class="nib-button" onclick={() => session.run('restart')}
          >{t('Restart')}</button
        >
        <button type="button" class="nib-button" onclick={() => session.run('stop')}
          >{t('Stop')}</button
        >
      </div>
    {:else if status.is === 'here' && status.state !== 'starting'}
      <button type="button" class="nib-button" onclick={() => session.run('start')}
        >{t('Start')}</button
      >
    {:else if waiting}
      <div class="sweep"><Sweep /></div>
    {/if}
  </div>
</div>

<style>
  /* On the pane's paper, which is the one surface that lays it (#1110). */
  .application {
    position: relative;
    height: 100%;
  }

  /* The online terminal's card, in the middle of the pane. */
  .status {
    position: absolute;
    top: 50%;
    left: 50%;
    translate: -50% -50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    max-width: min(24rem, calc(100% - var(--space-6)));
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--surface);
    box-shadow: var(--shadow-md);
  }

  p {
    margin: 0;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    text-align: center;
  }

  .quiet {
    color: var(--muted-strong);
  }

  .row {
    display: flex;
    gap: var(--space-2);
  }

  .sweep {
    width: 6rem;
  }
</style>

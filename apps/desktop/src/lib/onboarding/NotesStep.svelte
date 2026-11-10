<script lang="ts">
  import CopyButton from '../CopyButton.svelte'
  import { closeOnBack } from '../backstack.svelte'
  import { t } from '../i18n.svelte'
  import { importPrompt, MAIN_NOTES, NOTES_APPS, type NotesApp } from './catalog'
  import { matching, requestKey, typedName } from './flow'
  import RequestRow from './RequestRow.svelte'
  import Screen from './Screen.svelte'
  import SearchField from './SearchField.svelte'
  import { settleMarkdown, setup } from './setup.svelte'
  import Tile from './Tile.svelte'

  const UNLISTED = 'unlisted'

  let view = $state<'main' | 'other'>('main')
  let picked = $state<string | null>(null)
  let query = $state('')
  let bringing = $state(false)

  const main = MAIN_NOTES.map((id) => NOTES_APPS.find((one) => one.id === id)).filter(
    (one) => one !== undefined,
  )
  const shown = $derived(matching(NOTES_APPS, query))
  const nothing = $derived(!!query.trim() && !shown.length)

  const chosen = $derived.by((): NotesApp | null => {
    if (picked === UNLISTED) {
      return { id: UNLISTED, name: typedName(query), icon: null, colour: null, bring: null }
    }
    return NOTES_APPS.find((one) => one.id === picked) ?? null
  })

  const prompt = $derived(chosen && !chosen.bring ? importPrompt(chosen.name) : '')

  function pick(id: string) {
    picked = id
  }

  function other() {
    view = 'other'
    picked = null
    query = ''
  }

  function leave() {
    view = 'main'
    picked = null
  }

  $effect(() => closeOnBack(view === 'other', leave))

  async function done() {
    if (!chosen || bringing) return
    const app = chosen.id === UNLISTED ? null : chosen.id
    if (chosen.bring) {
      bringing = true
      const { bringNotes } = await import('./bring')
      const outcome = await bringNotes(chosen.bring).finally(() => (bringing = false))
      if (!outcome.picked) return
      setup.tell(outcome.trouble)
    }
    setup.answer({ notes: app })
    await settleMarkdown(app)
    setup.next()
  }
</script>

{#snippet more()}
  <svg class="glyph" viewBox="0 0 24 24" aria-hidden="true"
    ><circle cx="6" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle
      cx="18"
      cy="12"
      r="1.8"
    /></svg
  >
{/snippet}

<Screen
  title={t('Bring your notes')}
  onback={view === 'other' ? leave : null}
  primary={{
    label: bringing ? t('Importing') : t('Continue'),
    disabled: chosen === null,
    busy: bringing,
    onclick: () => void done(),
  }}
  quiet={{ label: t('Skip'), disabled: bringing, onclick: () => setup.next() }}
>
  {#if view === 'main'}
    <div class="o-grid rise" role="radiogroup" aria-label={t('Bring your notes')}>
      {#each main as one (one.id)}
        <Tile
          name={one.name}
          icon={one.icon}
          colour={one.colour}
          checked={picked === one.id}
          onpick={() => pick(one.id)}
        />
      {/each}
      <Tile name={t('Other')} checked={false} glyph={more} onpick={other} />
    </div>
  {:else}
    <div class="o-pane pane-in">
      <SearchField
        value={query}
        onvalue={(typed: string) => (query = typed)}
        label={t('Bring your notes')}
      />
      <div class="o-scroll">
        <div class="o-grid" role="radiogroup" aria-label={t('Bring your notes')}>
          {#each shown as one (one.id)}
            <Tile
              name={one.name}
              icon={one.icon}
              colour={one.colour}
              later={one.bring ? '' : t('Not yet')}
              checked={picked === one.id}
              onpick={() => pick(one.id)}
            />
          {/each}
          {#if nothing}
            <Tile
              name={typedName(query)}
              later={t('Request')}
              checked={picked === UNLISTED}
              onpick={() => pick(UNLISTED)}
            />
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if chosen && !chosen.bring}
    <div class="ask pane-in">
      <div class="o-list">
        <RequestRow
          name={chosen.name}
          icon={chosen.icon}
          colour={chosen.colour}
          asked={requestKey('notes', chosen.name)}
        />
      </div>
      <div class="anyway">
        <div class="anyway-head">
          <span>{t('Here’s how you can import it anyway')}</span>
          <CopyButton value={prompt} />
        </div>
        <pre class="prompt">{prompt}</pre>
      </div>
    </div>
  {/if}
</Screen>

<style>
  .glyph {
    width: 40px;
    height: 40px;
    fill: var(--muted);
  }

  .ask {
    width: 100%;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .anyway {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .anyway-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .prompt {
    margin: 0;
    max-height: 150px;
    overflow: auto;
    padding: 12px 14px;
    border-radius: 12px;
    background: var(--card);
    border: 1px solid var(--line);
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.55;
    white-space: pre-wrap;
    color: var(--text);
    text-align: start;
  }
</style>

<script lang="ts">
  import { fly } from 'svelte/transition'
  import { firstOf, refreshSpaces } from '../lib/account'
  import type { Space } from '../lib/api'
  import { t } from '../lib/i18n.svelte'
  import { type Kind, KINDS, LABELS } from '../lib/kinds'
  import { ask, type Clip } from '../lib/messages'
  import { noteFor } from '../lib/note'
  import { fill } from '../lib/placeholders'
  import { opened } from '../lib/opened'
  import { PROBLEMS } from '../lib/problems'

  const held = opened()

  /** How long the tick stays before the popup gets out of the way. Long enough
   *  to read the path it landed at. */
  const LINGER = 900

  let kind = $state<Kind>('page')
  let clip = $state<Clip | null>(null)
  let problem = $state<string | null>(null)
  let saving = $state(false)
  let saved = $state<string | null>(null)

  let spaces = $state<Space[]>(held.spaces)
  let spaceId = $state(firstOf(held.spaces, held.target.spaceId))
  let folder = $state(held.target.folder)

  /** Whether the account has answered about its spaces yet. An empty list means
   *  nothing until it has: the remembered one is empty on a first run too, and
   *  saying so before asking would be a sentence that is usually wrong. */
  let looked = $state(false)

  /** What the note will say, exactly: the same front matter, the same heading
   *  and the same body the save is about to send, with the pictures still at
   *  their own addresses because their blobs do not exist yet. */
  const preview = $derived(
    clip ? noteFor(clip.origin, fill(clip.markdown, clip.images), new Date(clip.clipped)) : '',
  )

  /** A signed-in account with no space to write into. */
  const nowhere = $derived(looked && spaces.length === 0)

  const ready = $derived(!!clip && !!spaceId && !saving && !saved)

  // The shell paints first and the page is read after it, so opening the popup
  // never waits on a tab. Each request remembers which action asked for it: a
  // second click while the first is in flight must not be answered by it.
  let asked = 0

  $effect(() => {
    const wanted = kind
    const mine = ++asked

    clip = null
    problem = null

    void ask({ ask: 'clip', kind: wanted }).then((answer) => {
      if (mine !== asked) return

      if (!answer) problem = PROBLEMS.unreachable
      else if ('problem' in answer) problem = answer.problem
      else if ('clip' in answer) clip = answer.clip
    })
  })

  // The remembered list is what the picker draws at once; the account is asked
  // afresh behind it, so a space made in the app this morning is there.
  $effect(() => {
    if (!held.token) return

    void refreshSpaces(held.token)
      .then((listed) => {
        spaces = listed
        spaceId = firstOf(listed, spaceId)
        looked = true
      })
      .catch(() => {
        // Nothing to say: the remembered list is still on screen, and a save
        // against a space that is gone reports it in its own words.
      })
  })

  async function keep() {
    if (!clip || !ready) return

    saving = true
    problem = null

    const answer = await ask({ ask: 'save', clip, spaceId, folder })
    saving = false

    if (!answer) problem = PROBLEMS.unreachable
    else if ('problem' in answer) problem = answer.problem
    else if ('path' in answer) {
      saved = answer.path
      setTimeout(() => window.close(), LINGER)
    }
  }
</script>

<div class="kinds" style:--at={KINDS.indexOf(kind)}>
  <span class="pill"></span>
  {#each KINDS as one (one)}
    <button class="tab" class:on={one === kind} type="button" onclick={() => (kind = one)}>
      {t(LABELS[one])}
    </button>
  {/each}
</div>

<div class="preview" class:waiting={!clip && !problem && !nowhere}>
  {#if problem}
    <p class="problem" transition:fly={{ y: -6, duration: 160 }}>{t(problem)}</p>
  {:else if nowhere}
    <p class="problem">{t(PROBLEMS.noSpaces)}</p>
  {:else if clip}
    <pre in:fly={{ y: 6, duration: 160 }}>{preview}</pre>
  {/if}
</div>

<div class="target">
  <select bind:value={spaceId} aria-label={t('Space')} disabled={!spaces.length}>
    {#each spaces as space (space.id)}
      <option value={space.id}>{space.name}</option>
    {/each}
  </select>
  <input
    bind:value={folder}
    placeholder={t('Folder')}
    spellcheck="false"
    aria-label={t('Folder')}
  />
</div>

<button class="save" type="button" disabled={!ready} onclick={() => keep()}>
  {#if saved}
    <span class="path">✓ {saved}</span>
  {:else}
    {saving ? t('Saving') : t('Save')}
  {/if}
</button>

<style>
  .kinds {
    position: relative;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    padding: 3px;
    border-radius: var(--radius-md);
    background: var(--surface-2);
  }

  /* One shape that moves rather than three that light up: the row reads as a
     single control with a position in it. */
  .pill {
    position: absolute;
    top: 3px;
    bottom: 3px;
    left: 3px;
    width: calc((100% - 6px) / 3);
    border-radius: calc(var(--radius-md) - 2px);
    background: var(--accent);
    translate: calc(var(--at) * 100%) 0;
    transition: translate var(--dur-base) var(--ease-out);
  }

  .tab {
    position: relative;
    padding: 7px 0;
    background: none;
    color: var(--muted-strong);
    font-size: var(--text-sm);
    font-weight: 550;
    transition: color var(--dur-fast) var(--ease-out);
  }

  .tab:hover:not(:disabled) {
    background: none;
    color: var(--text);
    transform: none;
  }

  .tab.on,
  .tab.on:hover {
    color: #fff;
  }

  .preview {
    flex: 1;
    min-height: 0;
    margin: var(--space-3) 0;
    padding: var(--space-3);
    overflow: auto;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    background: var(--surface);
  }

  /* Reading a page takes a moment. A surface that breathes says so without a
     word or a spinner. */
  .waiting {
    animation: breathe 1.4s var(--ease-in-out) infinite;
  }

  @keyframes breathe {
    50% {
      background: var(--surface-2);
    }
  }

  pre {
    margin: 0;
    color: var(--muted-strong);
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    line-height: 1.55;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .problem {
    margin: 0;
    color: var(--danger);
    font-size: var(--text-sm);
  }

  .target {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .target select,
  .target input {
    width: 100%;
    min-width: 0;
    padding: 8px 11px;
    font-size: var(--text-sm);
  }

  .target select {
    padding-right: 30px;
  }

  .save {
    width: 100%;
    margin-top: var(--space-3);
  }

  .path {
    display: block;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

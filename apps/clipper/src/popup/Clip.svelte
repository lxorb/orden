<script lang="ts">
  import { fly } from 'svelte/transition'
  import { firstOf, refreshSpaces } from '../lib/account'
  import type { Space } from '../lib/api'
  import { amount, plural, t } from '../lib/i18n.svelte'
  import { ready as setUp } from '../lib/interpret/providers'
  import { setupOf } from '../lib/interpret/setup'
  import { named, templateFor, templatesOf } from '../lib/interpret/templates'
  import type { Filled } from '../lib/interpret/values'
  import { filledFor, pageOf } from '../lib/interpreting'
  import { type Kind, KINDS, LABELS } from '../lib/kinds'
  import { ask, type Clip } from '../lib/messages'
  import { noteFor } from '../lib/note'
  import { fill } from '../lib/placeholders'
  import { opened } from '../lib/opened'
  import { PROBLEMS } from '../lib/problems'
  import { remember, settings } from '../lib/settings'

  const held = opened()

  /** The templates as they are written down, and the provider as it is set up.
   *  Both are settled when the popup opens: neither changes under it, and a popup
   *  that has to ask about either before it can draw is a popup that flashes.
   *
   *  No provider means no row: with nothing chosen in the options page the clipper
   *  is exactly what it was before any of this, and says nothing about a feature
   *  nobody asked for. */
  const templates = templatesOf(held.interpreter.templates)
  const setup = setupOf(held.interpreter)
  const offered = !!setup && setUp(setup)

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

  /** Which template is in the picker. Empty until a clip arrives and its address
   *  has claimed one; after that it is whatever somebody picked. */
  let chosen = $state('')
  /** The switch, by template name, as it was remembered and as it is being
   *  changed. */
  let switches = $state<Record<string, boolean>>({ ...held.interpreter.on })
  let filled = $state<Filled[]>([])
  let asking = $state(false)
  /** Why the provider said nothing useful. Its own place, because the clip itself
   *  is fine and the preview should keep showing it. */
  let refused = $state<string | null>(null)

  const template = $derived(named(templates, chosen))
  const on = $derived(!!template && !!switches[template.name])

  /** How much of the page would go to the provider, which is what the line under
   *  the row says while the switch is on. */
  const characters = $derived(clip ? pageOf(clip).text.length : 0)

  /** What the note will say, exactly: the same front matter, the same heading
   *  and the same body the save is about to send, with the pictures still at
   *  their own addresses because their blobs do not exist yet. */
  const preview = $derived(
    clip
      ? noteFor(clip.origin, fill(clip.markdown, clip.images), new Date(clip.clipped), filled)
      : '',
  )

  /** A signed-in account with no space to write into. */
  const nowhere = $derived(looked && spaces.length === 0)

  /** A save waits for the interpreter: the note it would write half way through
   *  one is a note missing the properties somebody asked for. */
  const ready = $derived(!!clip && !!spaceId && !saving && !saved && !asking)

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

  // The address picks the template, once, when the first clip arrives. After that
  // the picker holds whatever somebody picked, including across a change of tab:
  // a person who chose Recipe did not choose it for the Page tab alone.
  $effect(() => {
    if (chosen || !clip) return
    chosen = templateFor(templates, clip.origin.url)?.name ?? ''
  })

  // The page goes to the provider here and nowhere else, and only with the switch
  // on. Closing the popup, flipping the switch back or picking another template
  // aborts the request that was in flight rather than paying for an answer nobody
  // will read.
  let wondering = 0

  $effect(() => {
    const here = clip
    const wanted = template
    const asked = on

    filled = []
    refused = null
    if (!here || !wanted || !asked || !offered) return

    const mine = ++wondering
    const stop = new AbortController()
    asking = true

    void filledFor(here, wanted, held.interpreter, stop.signal).then((answer) => {
      if (mine !== wondering) return

      asking = false
      if ('filled' in answer) filled = answer.filled
      else refused = answer.problem
    })

    return () => {
      stop.abort()
      asking = false
    }
  })

  /** The switch is remembered against the template's name, and read afresh before
   *  it is written: the options page may be open on the same block. */
  async function flip() {
    if (!template) return

    const name = template.name
    const next = !switches[name]
    switches = { ...switches, [name]: next }

    const fresh = await settings()
    await remember({
      interpreter: { ...fresh.interpreter, on: { ...fresh.interpreter.on, [name]: next } },
    })
  }

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

    const answer = await ask({ ask: 'save', clip: { ...clip, filled }, spaceId, folder })
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

<div
  class="preview"
  class:waiting={!clip && !problem && !nowhere}
  class:saying={!!problem || nowhere}
>
  {#if problem}
    <p class="problem" transition:fly={{ y: -6, duration: 160 }}>{t(problem)}</p>
  {:else if nowhere}
    <p class="problem">{t(PROBLEMS.noSpaces)}</p>
  {:else if clip}
    <pre in:fly={{ y: 6, duration: 160 }}>{preview}</pre>
  {/if}
</div>

{#if offered}
  <div class="reading">
    <select bind:value={chosen} aria-label={t('Template')}>
      <!-- Untranslated on purpose: a template's name is what the templates say it
           is, it is the key the switch is remembered under, and a picker showing
           one word while the text below it says another is a picker that lies. -->
      {#each templates as one (one.name)}
        <option value={one.name}>{one.name}</option>
      {/each}
    </select>
    <button
      class="switch"
      class:on
      class:working={asking}
      type="button"
      aria-pressed={on}
      onclick={() => void flip()}
    >
      {t('Interpret')}
    </button>
  </div>

  <p class="said" class:bad={!!refused}>
    {#if refused}
      {t(refused)}
    {:else if on}
      <!-- A count, so the row is the shape the language wants rather than
           English's two, and the number is grouped the way this language groups
           one rather than the way the browser's own does. -->
      {plural(
        characters,
        { one: '{count} character sent', other: '{count} characters sent' },
        { count: amount(characters) },
      )}
    {/if}
  </p>
{/if}

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
    inset-inline-start: 3px;
    width: calc((100% - 6px) / 3);
    border-radius: calc(var(--radius-md) - 2px);
    background: var(--accent);
    /* Which of the three is chosen, counted from the end a line starts at, so it
       moves towards the words under a right-to-left interface; see
       apps/desktop/src/lib/direction.ts. */
    translate: calc(var(--dir) * var(--at) * 100%) 0;
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

  /* A sentence is the whole of what the box has to say, so it sits in the
     middle of it rather than in a corner. */
  .saying {
    display: grid;
    place-items: center;
    text-align: center;
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

  /* The template on the left with the room to be read, the switch on the right at
     the width of its own word. */
  .reading {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: var(--space-2);
  }

  /* The switch off is the quiet surface every other secondary control uses; on, it
     is the accent the kinds' pill wears, so one look says which of the two states
     the popup is in. */
  .switch {
    padding: 8px 13px;
    background: var(--surface-2);
    color: var(--muted-strong);
    font-size: var(--text-sm);
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .switch:hover:not(:disabled) {
    background: var(--surface-3);
    color: var(--text);
  }

  .switch.on,
  .switch.on:hover {
    background: var(--accent);
    color: #fff;
  }

  /* Asking a provider takes a moment, and the same breath the preview uses says so
     without a word or a spinner. */
  .switch.working {
    animation: breathe 1.4s var(--ease-in-out) infinite;
  }

  /* One line under the row, and always there whether it says anything or not: what
     it has to say arrives and goes without the popup resizing under the cursor. */
  .said {
    min-height: 1.35em;
    margin: 5px 0 var(--space-3);
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .said.bad {
    color: var(--danger);
  }

  .target {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: var(--space-2);
  }

  .reading select,
  .target select,
  .target input {
    width: 100%;
    min-width: 0;
    padding: 8px 11px;
    font-size: var(--text-sm);
  }

  .reading select,
  .target select {
    padding-inline-end: 30px;
  }

  .save {
    width: 100%;
    margin-top: var(--space-3);
  }

  /* A note that exists is not a button that is off: the press has landed, and
     what is left is the path it landed at. */
  .save:has(.path):disabled {
    opacity: 1;
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

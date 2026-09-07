<script lang="ts">
  import type { VimMode } from '@nib/editor'
  import { countText } from './counts'
  import { t } from './i18n.svelte'
  import { VIM_WORDS } from './modes.svelte'

  const {
    doc = '',
    reading = false,
    vimMode = null,
  }: { doc?: string; reading?: boolean; vimMode?: VimMode | null } = $props()

  /** Whether the pointer is on the numbers. They are invisible until then, and
   *  counting the words of a large note is not something to do on the way past:
   *  reading them is what asks for them. */
  let looking = $state(false)

  const counts = $derived(looking ? countText(doc) : null)
</script>

<!-- Which mode the keyboard is in, on the left, and only while modal editing is
     on. It shows unasked because that is the whole of its job: whether the next
     keystroke is a letter or a command is the one thing a reader cannot guess.
     Muted while a keystroke is a command, in the accent while it is text. -->
{#if vimMode}
  <span class="mode" class:writing={vimMode !== 'normal'}>{t(VIM_WORDS[vimMode])}</span>
{/if}

<!-- The one place the app says what is true of the note it is showing, so the
     word for a note nobody can type into goes here rather than into a banner
     over the text. It is the only thing in the bar that shows unasked. -->
<footer
  class:looking={looking || reading}
  onpointerenter={() => (looking = true)}
  onpointerleave={() => (looking = false)}
>
  {#if reading}
    <span class="reading">{t('Read-only')}</span>
  {/if}
  {#if counts}
    <span>{counts.words.toLocaleString()}w</span>
    <span>{counts.characters.toLocaleString()}c</span>
    <span>{counts.lines.toLocaleString()}l</span>
    <span>{counts.minutes}m</span>
  {/if}
</footer>

<style>
  /* Opposite corner from the numbers, on the same line, and floated the same
     way so it reserves nothing while modal editing is off. */
  .mode {
    position: absolute;
    left: 0;
    bottom: 0;
    padding: 4px var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    letter-spacing: 0.08em;
    color: var(--muted);
    transition: color var(--dur-base) var(--ease-out);
    user-select: none;
    pointer-events: none;
  }

  .mode.writing {
    color: var(--accent);
  }

  /* Numbers only, and only when looked for. Floated rather than laid out, so
     an invisible bar never reserves a strip of empty space. */
  footer {
    position: absolute;
    right: 0;
    bottom: 0;
    display: flex;
    gap: var(--space-3);
    /* Room to aim at even while there is nothing in it yet. */
    min-width: var(--space-7);
    min-height: 1.4em;
    padding: 4px var(--space-4);
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--muted);
    opacity: 0;
    transition: opacity var(--dur-slow) var(--ease-out);
    user-select: none;
    pointer-events: auto;
  }

  footer.looking {
    opacity: 1;
  }

  /* Said once and quietly; the numbers come in beside it on hover. */
  .reading {
    letter-spacing: 0.03em;
  }

  /* There is no hover on a phone, so this never appears - but it still sits in
     the corner catching taps meant for the button that does. Nor is there a
     keyboard with modes on one. */
  @media (max-width: 720px) {
    footer,
    .mode {
      display: none;
    }
  }
</style>

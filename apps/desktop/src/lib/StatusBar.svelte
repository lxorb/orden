<script lang="ts">
  import { countText } from './counts'
  import { t } from './i18n.svelte'

  let { doc = '', reading = false }: { doc?: string; reading?: boolean } = $props()

  /** Whether the pointer is on the numbers. They are invisible until then, and
   *  counting the words of a large note is not something to do on the way past:
   *  reading them is what asks for them. */
  let looking = $state(false)

  const counts = $derived(looking ? countText(doc) : null)
</script>

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

  /* Said once, quietly, and never in the way: the numbers slide in beside it
     when the pointer comes over. */
  .reading {
    letter-spacing: 0.03em;
  }

  /* There is no hover on a phone, so this never appears - but it still sits in
     the corner catching taps meant for the button that does. */
  @media (max-width: 720px) {
    footer {
      display: none;
    }
  }
</style>

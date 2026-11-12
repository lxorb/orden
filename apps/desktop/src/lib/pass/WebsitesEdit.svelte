<script lang="ts">
  import { MATCH_RULES, type MatchRule, type Website } from '@orden/pass/types'
  import Plus from 'lucide/dist/esm/icons/plus.mjs'
  import Cross from '../Cross.svelte'
  import Select from '../Select.svelte'
  import { FIELD_ICONS } from './field-icons'
  import { matchLabel } from './field-words'
  import Glyph from './Glyph.svelte'

  /* eslint-disable prefer-const, @typescript-eslint/no-useless-default-assignment -- the content is bindable, and a $props() pattern cannot be split */
  let { websites = $bindable(), oninput }: { websites: Website[]; oninput: () => void } = $props()
  /* eslint-enable prefer-const, @typescript-eslint/no-useless-default-assignment */

  const rules = $derived(MATCH_RULES.map((rule) => ({ value: rule, label: matchLabel(rule) })))

  function add() {
    websites = [...websites, { url: '', match: 'domain' }]
    oninput()
  }

  function remove(at: number) {
    websites = websites.filter((_, index) => index !== at)
    oninput()
  }

  function ruleOf(value: string): MatchRule {
    return MATCH_RULES.find((rule) => rule === value) ?? 'domain'
  }
</script>

<div class="websites orden-edit-row">
  <span class="mark"><Glyph icon={FIELD_ICONS.website} /></span>
  <div class="list">
    <span class="label">Websites</span>
    {#each websites as website, at (at)}
      <div class="site">
        <input
          class="url"
          bind:value={website.url}
          placeholder="https://"
          inputmode="url"
          autocomplete="off"
          spellcheck="false"
          aria-label="Website"
          {oninput}
        />
        <div class="rule">
          <Select
            plain
            value={website.match}
            options={rules}
            label="Fill on"
            onchange={(value: string) => {
              website.match = ruleOf(value)
              oninput()
            }}
          />
        </div>
        <button
          type="button"
          class="orden-glyph"
          aria-label="Remove"
          title="Remove"
          onclick={() => remove(at)}
        >
          <Cross />
        </button>
      </div>
    {/each}
    <button type="button" class="orden-button is-quiet add" onclick={add}>
      <Glyph icon={Plus} />
      <span>Add website</span>
    </button>
  </div>
</div>

<style>
  .websites {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
  }

  .mark {
    flex: none;
    margin-top: 11px;
    color: var(--muted);
  }

  .list {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .label {
    font-size: var(--text-xs);
    color: var(--muted);
  }

  .site {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .url {
    flex: 1;
    min-width: 0;
    min-height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: none;
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-row);
  }

  .url::placeholder {
    color: var(--muted);
  }

  .rule {
    flex: none;
    width: 11rem;
    max-width: 40%;
  }

  .orden-glyph :global(.orden-cross) {
    width: var(--icon-lg);
    height: var(--icon-lg);
    stroke-width: 1.5;
  }

  .add {
    align-self: flex-start;
    padding-inline: 0;
    font-size: var(--text-sm);
  }
</style>

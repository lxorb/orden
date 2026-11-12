<script lang="ts">
  import { MOST_LINK_VIEWS } from '@orden/pass/wire'
  import Copy from 'lucide/dist/esm/icons/copy.mjs'
  import { account } from '../account.svelte'
  import { message } from '../message'
  import { said } from '../said.svelte'
  import Select from '../Select.svelte'
  import Sheet from '../Sheet.svelte'
  import Glyph from './Glyph.svelte'
  import { lifeName } from './link-words'
  import { createLink, LINK_LIVES, type LinkLife } from './links'
  import { mayEdit } from './share-rules'
  import { pass } from './store.svelte'
  import type { PassUi } from './ui.svelte'

  const { ui }: { ui: PassUi } = $props()

  const A_WEEK: LinkLife = LINK_LIVES[2]

  const asked = $derived(ui.sheet?.kind === 'link' ? ui.sheet : null)
  const itemId = $derived(asked?.item ?? null)
  const item = $derived(
    itemId === null ? null : (pass.items.find((one) => one.id === itemId) ?? null),
  )
  const vault = $derived(item ? (pass.vaults.find((one) => one.id === item.vault) ?? null) : null)
  const signedIn = $derived(account.user !== null)
  const lives = $derived(LINK_LIVES.map((one) => ({ value: String(one), label: lifeName(one) })))

  let expires = $state<LinkLife>(A_WEEK)
  let views = $state('')
  let url = $state<string | null>(null)
  let busy = $state(false)
  let wrong = $state('')

  const limit = $derived(views.trim() === '' ? null : Number(views.trim()))
  const fits = $derived(
    limit === null || (Number.isInteger(limit) && limit >= 1 && limit <= MOST_LINK_VIEWS),
  )

  $effect(() => {
    if (itemId === null) return
    expires = A_WEEK
    views = ''
    url = null
    wrong = ''
  })

  const close = () => (ui.sheet = null)

  async function made(event: SubmitEvent) {
    event.preventDefault()
    if (!item || !fits || busy) return
    busy = true
    wrong = ''
    try {
      url = (await createLink(item, { expires, views: limit })).url
    } catch (error) {
      wrong = message(error, 'The link could not be made.')
    } finally {
      busy = false
    }
  }

  async function copied() {
    if (url === null) return
    await pass.copy(url)
    said.say('Link copied')
  }
</script>

<Sheet open={asked !== null} title="Create secure link" onclose={close}>
  <div class="link">
    {#if !signedIn}
      <p class="quiet" data-signed-out>Sign in to share</p>
    {:else if !item || !vault || !mayEdit(vault)}
      <p class="quiet">Only editors of the vault can make secure links.</p>
    {:else if url !== null}
      <p class="quiet">
        Anybody with this link can see {item.content.title || 'Untitled'}. It is shown only now.
      </p>
      <div class="made">
        <input
          class="orden-field is-value is-mono"
          readonly
          value={url}
          aria-label="Secure link"
          data-link-url
          onfocus={(event) => event.currentTarget.select()}
        />
        <button class="orden-button" type="button" onclick={() => void copied()}>
          <Glyph icon={Copy} />
          Copy
        </button>
      </div>
      <div class="buttons">
        <button class="orden-button is-quiet" type="button" onclick={close}>Done</button>
      </div>
    {:else}
      <form class="form" onsubmit={made}>
        <p class="quiet">
          Anybody with the link sees this item without an account. Its attachments stay out.
        </p>
        <div class="orden-setting row">
          <span class="name">Expires after</span>
          <div class="pick">
            <Select
              label="Expires after"
              value={String(expires)}
              options={lives}
              onchange={(next: string) => (expires = Number(next))}
            />
          </div>
        </div>
        <label class="orden-setting row">
          <span class="name">Max views</span>
          <input
            class="orden-field is-value views"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            placeholder="Unlimited"
            aria-label="Max views"
            bind:value={views}
          />
        </label>
        {#if !fits}
          <p class="wrong" role="alert">
            Choose 1 to {MOST_LINK_VIEWS} views, or leave it empty.
          </p>
        {/if}
        {#if wrong}<p class="wrong" role="alert">{wrong}</p>{/if}
        <div class="buttons">
          <button class="orden-button is-quiet" type="button" onclick={close}>Cancel</button>
          <button class="orden-button" type="submit" disabled={busy || !fits}>Create</button>
        </div>
      </form>
    {/if}
  </div>
</Sheet>

<style>
  .link,
  .form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .link {
    padding: 0 var(--space-2) var(--space-2);
  }

  .row {
    gap: var(--space-2);
    padding: var(--space-1) 0;
  }

  .name {
    flex: 1;
  }

  .pick,
  .views {
    flex: none;
    width: 10rem;
  }

  .made {
    display: flex;
    gap: var(--space-2);
  }

  .made input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
  }

  .quiet {
    margin: 0;
    color: var(--muted);
    font-size: var(--text-sm);
  }

  .wrong {
    margin: 0;
    font-size: var(--text-sm);
    color: var(--danger);
  }

  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>

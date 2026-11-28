<script lang="ts">
  import { account } from '../../accounts/src/api'
  import CodeBoxes from './CodeBoxes.svelte'
  import LogoTile from './LogoTile.svelte'
  import Screen from './Screen.svelte'
  import { closeOnBack } from '../../ui-kit/src/api'

  const {
    name = null,
    alone = true,
    back = null,
    onaccepted = () => undefined,
    ondone,
    onalone = null,
  }: {
    name?: string | null
    alone?: boolean
    back?: (() => void) | null
    onaccepted?: () => void
    ondone: () => void
    onalone?: (() => void) | null
  } = $props()
  const WORDS = 'Log in or sign up'
  const LENGTH = 6
  let entered = $state('')
  let boxes = $state<{ focus: () => void }>()
  let field = $state<HTMLInputElement>()
  let submitted = $state('')
  let signed = $state(false)
  const asking = $derived(account.step === 'code' || account.step === 'second')
  const typed = $derived(/.+@.+\..+/.test(account.email.trim()))
  $effect(() => {
    if (!asking) setTimeout(() => field?.focus({ preventScroll: true }), 300)
  })
  $effect(() => {
    if (!asking) return
    entered = ''
    submitted = ''
    setTimeout(() => boxes?.focus(), 60)
  })
  let moving: ReturnType<typeof setTimeout> | undefined
  $effect(() => () => clearTimeout(moving))
  function again() {
    entered = ''
    submitted = ''
    setTimeout(() => boxes?.focus(), 0)
  }
  $effect(() => {
    if (entered.length !== LENGTH || entered === submitted) return
    submitted = entered
    void account
      .code(entered)
      .then((accepted) => {
        account.open = false
        if (!accepted) {
          again()
          return
        }
        signed = true
        onaccepted()
        moving = setTimeout(ondone, 900)
      })
      .catch(again)
  })
  function changeEmail() {
    account.step = 'email'
    account.error = null
  }
  $effect(() => closeOnBack(asking && !signed, changeEmail))
  function send() {
    if (typed && !account.busy) void account.requestCode()
  }
</script>

{#snippet head()}
  <LogoTile size={88} assemble class="rise" />
{/snippet}

<Screen
  title={name ?? WORDS}
  {head}
  back={asking && !signed ? changeEmail : back}
  primary={asking || signed
    ? null
    : {
        label: account.busy ? 'Sending' : 'Continue',
        disabled: !typed,
        busy: account.busy,
        onclick: send,
      }}
  quiet={signed || !alone || !onalone ? null : { label: 'Use without an account', onclick: onalone }}
>
  {#if name}<p class="what rise">{WORDS}</p>{/if}
  {#if signed}
    <svg class="tick" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16 9.5" />
    </svg>
  {:else if asking}
    <div class="stack">
      <p class="muted">
        {#if account.step === 'second'}
          Now the code from your authenticator app
        {:else}
          Code sent to <strong>{account.email}</strong>
        {/if}
      </p>
      <CodeBoxes bind:this={boxes} bind:value={entered} />
      {#if account.step === 'code'}
        <button
          class="link"
          type="button"
          disabled={account.resendIn > 0 || account.busy}
          onclick={() => account.requestCode()}
        >
          {account.resendIn > 0 ? `Resend in ${account.resendIn}s` : 'Send a new code'}
        </button>
      {/if}
    </div>
  {:else}
    <form
      class="stack rise"
      onsubmit={(event) => {
        event.preventDefault()
        send()
      }}
    >
      <input
        bind:this={field}
        bind:value={account.email}
        class="o-field"
        type="email"
        autocomplete="email"
        placeholder="Email address"
        aria-label="Email address"
        spellcheck="false"
      />
    </form>
  {/if}
  {#if account.error && !signed}
    <p class="o-error" role="alert">{account.error}</p>
  {/if}
</Screen>

<style>
  .stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
  }
  .what {
    margin: 0;
    font-size: 17px;
    line-height: 1.4;
    text-align: center;
    color: var(--muted);
  }
  .muted {
    margin: 0;
    color: var(--muted);
    font-size: 14px;
    text-align: center;
  }
  .muted strong {
    color: var(--text);
  }
  .link {
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
    min-height: 48px;
    padding-inline: 12px;
  }
  .link:disabled {
    color: var(--muted);
    cursor: default;
  }
  .tick {
    width: 40px;
    height: 40px;
    fill: none;
    stroke: var(--success);
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
</style>

<script lang="ts">
  import { account } from '../../accounts/src/api'
  import { joining } from '../../sharing/src/api'
  import Mark from './Mark.svelte'
  import Screen from './Screen.svelte'
  import { setup } from './setup-state.svelte'

  const LENGTH = 6
  const blank = () => Array.from({ length: LENGTH }, () => '')

  let digits = $state<string[]>(blank())
  const boxes = $state<HTMLInputElement[]>([])
  let field = $state<HTMLInputElement>()
  let submitted = $state('')
  let signed = $state(false)

  const entered = $derived(digits.join(''))
  const asking = $derived(account.step === 'code' || account.step === 'second')
  const typed = $derived(/.+@.+\..+/.test(account.email.trim()))

  $effect(() => {
    if (!asking) setTimeout(() => field?.focus({ preventScroll: true }), 300)
  })

  $effect(() => {
    if (!asking) return
    digits = blank()
    submitted = ''
    setTimeout(() => boxes[0]?.focus(), 60)
  })

  $effect(() => {
    if (entered.length !== LENGTH || entered === submitted) return
    submitted = entered
    void account.code(entered).then((accepted) => {
      account.open = false
      if (!accepted) {
        digits = blank()
        submitted = ''
        setTimeout(() => boxes[0]?.focus(), 0)
        return
      }
      signed = true
      void import('../../settling').then(({ settleLocalNotes }) =>
        settleLocalNotes().then(() => joining.walkThrough()),
      )
      setTimeout(() => setup.next(), 900)
    })
  })

  function onDigit(index: number, event: Event) {
    const input = event.target as HTMLInputElement
    const value = input.value.replace(/\D/g, '')
    if (!value) {
      digits[index] = ''
      return
    }
    for (let offset = 0; offset < value.length && index + offset < LENGTH; offset++) {
      digits[index + offset] = value.charAt(offset)
    }
    input.value = digits[index] ?? ''
    boxes[Math.min(index + value.length, LENGTH - 1)]?.focus()
  }

  function onDigitKey(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) {
      event.preventDefault()
      digits[index - 1] = ''
      boxes[index - 1]?.focus()
    }
    if (event.key === 'ArrowLeft' && index > 0) boxes[index - 1]?.focus()
    if (event.key === 'ArrowRight' && index < LENGTH - 1) boxes[index + 1]?.focus()
  }

  function send() {
    if (typed && !account.busy) void account.requestCode()
  }
</script>

{#snippet head()}
  <span class="tile rise"><Mark size={52} assemble /></span>
{/snippet}

<Screen
  title="Log in or sign up"
  {head}
  primary={asking || signed
    ? null
    : {
        label: account.busy ? 'Sending' : 'Continue',
        disabled: !typed,
        busy: account.busy,
        onclick: send,
      }}
  quiet={signed ? null : { label: 'Use without an account', onclick: () => setup.next() }}
>
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
      <div class="digits" dir="ltr">
        {#each digits as digit, index (index)}
          <input
            bind:this={boxes[index]}
            value={digit}
            oninput={(event) => onDigit(index, event)}
            onkeydown={(event) => onDigitKey(index, event)}
            inputmode="numeric"
            autocomplete={index === 0 ? 'one-time-code' : 'off'}
            maxlength="6"
            aria-label="Digit {index + 1}"
          />
        {/each}
      </div>
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
        class="field"
        type="email"
        autocomplete="email"
        placeholder="Email address"
        aria-label="Email address"
        spellcheck="false"
      />
    </form>
  {/if}
  {#if account.error && !signed}
    <p class="error" role="alert">{account.error}</p>
  {/if}
</Screen>

<style>
  .tile {
    width: 88px;
    height: 88px;
    border-radius: 22px;
    display: grid;
    place-items: center;
    background: linear-gradient(135deg, #c8ddfa, #e8c9ef);
    box-shadow:
      0 20px 50px -18px rgb(91 75 224 / 0.45),
      inset 0 0 0 1px rgb(255 255 255 / 0.5);
  }

  .stack {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    width: 100%;
  }

  .field {
    width: min(360px, 100%);
    height: 50px;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--card);
    padding: 0 16px;
    font: inherit;
    font-size: 16px;
    color: var(--text);
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

  .digits {
    display: flex;
    gap: 8px;
  }

  .digits input {
    width: 46px;
    height: 56px;
    text-align: center;
    font-size: 22px;
    font-weight: 600;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--card);
    color: var(--text);
    font-family: var(--font-ui);
    font-variant-numeric: tabular-nums;
  }

  .link {
    border: 0;
    background: none;
    color: var(--accent);
    font: inherit;
    font-size: 14px;
    cursor: pointer;
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

  .error {
    margin: 0;
    color: var(--danger);
    font-size: 14px;
    text-align: center;
  }

  @media (max-width: 640px) {
    .digits input {
      width: 40px;
      height: 50px;
    }
  }
</style>

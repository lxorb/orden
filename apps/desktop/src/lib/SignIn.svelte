<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { t } from './i18n.svelte'
  import { fade, fly, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { account } from './account.svelte'
  import { prompt } from './prompt.svelte'
  import { workspace } from './workspace.svelte'

  const LENGTH = 6

  let digits = $state<string[]>(Array(LENGTH).fill(''))
  let boxes = $state<HTMLInputElement[]>([])
  let emailField = $state<HTMLInputElement>()

  const entered = $derived(digits.join(''))

  /** The last code sent for checking. Without this the effect below would
   *  resubmit the same digits every time `busy` flips back, burning attempts. */
  let submitted = $state('')

  $effect(() => {
    if (account.open && account.step === 'email') emailField?.focus()
  })

  $effect(() => {
    if (account.step === 'code') {
      digits = Array(LENGTH).fill('')
      submitted = ''
      setTimeout(() => boxes[0]?.focus(), 60)
    }
  })

  // Six digits is the whole code, so check it as soon as they are all there.
  // A rejected code empties the row, ready for the next attempt.
  $effect(() => {
    if (entered.length !== LENGTH || entered === submitted) return

    submitted = entered
    account.verify(entered).then((accepted) => {
      if (accepted) return void settleLocalNotes()

      digits = Array(LENGTH).fill('')
      submitted = ''
      setTimeout(() => boxes[0]?.focus(), 0)
    })
  })

  function onDigit(index: number, event: Event) {
    const input = event.target as HTMLInputElement
    const value = input.value.replace(/\D/g, '')

    if (!value) {
      digits[index] = ''
      return
    }

    // A pasted code fills the row from wherever it landed.
    for (let offset = 0; offset < value.length && index + offset < LENGTH; offset++) {
      digits[index + offset] = value[offset]
    }

    input.value = digits[index]
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

  /** Signing in on a machine that already holds notes needs an answer: they
   *  either join the account or they go. Nothing is deleted without one, and
   *  syncing waits for it - a first pass would otherwise send up what is about
   *  to be erased, and bring the account's spaces down into the erase. */
  async function settleLocalNotes() {
    try {
      if (!(await workspace.hasLocalContent())) return

      const answer = await prompt.choose({
        title: t('You already have notes on this computer.'),
        detail: t(
          'Keep them and they join your account. Erase them and only what your account already holds remains - this cannot be undone.',
        ),
        options: [
          { id: 'keep', label: t('Keep them'), primary: true },
          { id: 'erase', label: t('Erase them'), danger: true },
        ],
      })

      // Dismissing the question keeps them, which is the answer that loses nothing.
      if (answer === 'erase') await workspace.eraseLocalSpaces()
    } finally {
      account.settled()
    }
  }

  function close() {
    account.open = false
    account.step = 'email'
    account.error = null
  }

  // Back closes this before it leaves the app.
  $effect(() => closeOnBack(account.open, () => (account.open = false)))
</script>

{#if account.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 140 }} onclick={close}></div>

  <div class="panel" transition:scale={{ duration: 200, start: 0.96, easing: cubicOut }}>
    {#if account.step === 'email'}
      <form
        in:fly={{ x: -14, duration: 200, easing: cubicOut }}
        onsubmit={(event) => {
          event.preventDefault()
          account.requestCode()
        }}
      >
        <input
          bind:this={emailField}
          bind:value={account.email}
          type="email"
          autocomplete="email"
          placeholder="you@example.com"
          aria-label={t('Email address')}
          spellcheck="false"
          required
        />
        <button type="submit" disabled={account.busy}>
          {account.busy ? t('Sending') : t('Continue')}
        </button>
      </form>
    {:else}
      <div class="code" in:fly={{ x: 14, duration: 200, easing: cubicOut }}>
        <p class="sent">{t('Code sent to')} <strong>{account.email}</strong></p>

        <div class="digits">
          {#each digits as digit, index (index)}
            <input
              bind:this={boxes[index]}
              value={digit}
              oninput={(event) => onDigit(index, event)}
              onkeydown={(event) => onDigitKey(index, event)}
              inputmode="numeric"
              autocomplete={index === 0 ? 'one-time-code' : 'off'}
              maxlength="6"
              aria-label={t('Digit {number}', { number: index + 1 })}
              style:animation-delay="{index * 32}ms"
            />
          {/each}
        </div>

        <button
          class="link"
          type="button"
          disabled={account.resendIn > 0 || account.busy}
          onclick={() => account.requestCode()}
        >
          {account.resendIn > 0
            ? t('Resend in {seconds}s', { seconds: account.resendIn })
            : t('Send a new code')}
        </button>
      </div>
    {/if}

    {#if account.error}
      <p class="error" transition:fly={{ y: -6, duration: 160 }}>{t(account.error)}</p>
    {/if}
  </div>
{/if}

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 30;
  }

  .panel {
    position: fixed;
    top: 22vh;
    left: 50%;
    translate: -50% 0;
    width: min(23rem, calc(100vw - 3rem));
    z-index: 31;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  input {
    width: 100%;
    padding: 11px 13px;
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    background: var(--bg);
    color: var(--text-strong);
    font-family: var(--font-ui);
    font-size: var(--text-base);
    outline: none;
    transition:
      border-color var(--dur-fast) var(--ease-out),
      box-shadow var(--dur-fast) var(--ease-out);
  }

  input:focus {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--accent-soft);
  }

  input::placeholder {
    color: var(--muted);
  }

  button {
    padding: 10px 14px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--accent);
    color: #fff;
    font-family: var(--font-ui);
    font-size: var(--text-base);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      transform var(--dur-fast) var(--ease-spring);
  }

  button:hover:not(:disabled) {
    background: var(--accent-hover);
    transform: translateY(-1px);
  }

  /* Signing in is a round trip to a server: the button has to look pressed
     before it looks busy. */
  button:active:not(:disabled) {
    background: var(--accent-press);
    transform: translateY(0);
  }

  button:disabled {
    opacity: 0.55;
  }

  .sent {
    margin: 0 0 var(--space-4);
    font-size: var(--text-sm);
    color: var(--muted-strong);
    text-align: center;
  }

  .sent strong {
    color: var(--text);
    font-weight: 550;
  }

  .digits {
    display: flex;
    gap: 7px;
    justify-content: center;
  }

  .digits input {
    width: 2.6rem;
    padding: 12px 0;
    text-align: center;
    font-family: var(--font-mono);
    font-size: 1.25rem;
    animation: drop var(--dur-base) var(--ease-spring) backwards;
  }

  @keyframes drop {
    from {
      opacity: 0;
      transform: translateY(-6px) scale(0.9);
    }
  }

  .link {
    display: block;
    margin: var(--space-4) auto 0;
    padding: 4px 8px;
    background: none;
    color: var(--muted);
    font-size: var(--text-sm);
    font-weight: 400;
  }

  .link:hover:not(:disabled) {
    background: none;
    color: var(--accent);
    transform: none;
  }

  .error {
    margin: var(--space-3) 0 0;
    font-size: var(--text-sm);
    color: var(--danger);
    text-align: center;
  }

  @media (max-width: 720px) {
    .panel {
      top: auto;
      bottom: 0;
      left: 0;
      translate: none;
      width: 100%;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding-bottom: calc(var(--space-5) + env(safe-area-inset-bottom));
    }
  }
</style>

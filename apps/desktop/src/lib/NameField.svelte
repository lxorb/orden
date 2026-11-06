<script lang="ts">
  import { fly } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { hang } from './portal'
  import { dur } from './motion'
  import { type NameFault, nameFault, nameToCommit } from './naming'
  import { caretAtEnd, selectAll, selectStem } from './select-all'

  interface Props {
    value: string
    extension?: string
    current?: string | undefined
    taken?: readonly string[]
    space?: string | undefined
    appending?: boolean
    oncommit: (name: string) => void
    oncancel: () => void
    wrong?: boolean
  }

  /* eslint-disable prefer-const, no-useless-assignment -- `wrong` is bindable: a
     $props() pattern cannot be split, and what reads it is the row outside */
  let {
    value,
    extension = '',
    current,
    taken = [],
    space,
    appending = false,
    oncommit,
    oncancel,
    wrong = $bindable(false),
  }: Props = $props()
  /* eslint-enable prefer-const, no-useless-assignment */

  // svelte-ignore state_referenced_locally
  let typed = $state(value)

  const fault = $derived(nameFault({ typed, extension, taken, current }))

  const amiss = $derived(fault !== null && fault !== 'empty')

  $effect(() => {
    wrong = amiss

    return () => {
      wrong = false
    }
  })

  function reasonFor(reason: NameFault | null): string | null {
    switch (reason) {
      case 'separator':
        return t('A name cannot hold a slash')
      case 'illegal':
        return t('A name cannot hold that character')
      case 'trailing':
        return t('A name cannot end with a dot')
      case 'reserved':
        return t('Windows keeps this name for itself')
      case 'taken':
        return t('That name is taken')
      case 'agents':
        return t("AGENTS is this space's agent instructions")
      case 'empty':
      case null:
        return null
    }
  }

  const reason = $derived(reasonFor(fault))

  let settled = false

  function leave(event?: FocusEvent) {
    if (settled || (event?.relatedTarget && event.relatedTarget === hint)) return
    settled = true

    const told = fault === 'agents' ? space : undefined
    const name = nameToCommit({ typed, extension, taken, was: value, current })
    if (name === null) oncancel()
    else oncommit(name)
    if (told) void refused().then((one) => one.reservedName.tell(told))
  }

  const refused = () => import('./reserved-name.svelte')

  let field = $state<HTMLInputElement>()
  let hint = $state<HTMLButtonElement>()

  function follow() {
    const told = space
    escape()
    if (told) void refused().then((one) => one.openInstructions(told))
  }

  function escape() {
    if (settled) return
    settled = true
    oncancel()
  }

  function caret(node: HTMLInputElement) {
    if (appending) return caretAtEnd(node)

    const carries = extension !== '' && value.toLowerCase().endsWith(extension.toLowerCase())
    return carries ? selectStem(node) : selectAll(node)
  }
</script>

<span class="naming" class:wrong={amiss}>
  <input
    bind:value={typed}
    spellcheck="false"
    autocapitalize="off"
    autocorrect="off"
    enterkeyhint="done"
    aria-label={t('Name')}
    aria-invalid={amiss}
    bind:this={field}
    use:caret
    onblur={leave}
    onkeydown={(event) => {
      if (event.key === 'Enter') {
        event.preventDefault()
        leave()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        escape()
      } else if (event.key === 'Tab') {
        event.preventDefault()
        hint?.focus()
      }
    }}
  />

  {#if fault === 'agents' && space}
    <span
      class="nib-bubble is-pressable reason held"
      aria-live="polite"
      use:hang={{ side: 'below', gap: 4, stretch: true }}
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}
    >
      <button
        bind:this={hint}
        type="button"
        class="go"
        onpointerdown={(event) => event.preventDefault()}
        onclick={(event) => {
          event.stopPropagation()
          follow()
        }}
        onblur={(event) => {
          if (event.relatedTarget !== field) leave()
        }}
        onkeydown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            follow()
          } else if (event.key === 'Escape') {
            event.preventDefault()
            escape()
          } else if (event.key === 'Tab') {
            event.preventDefault()
            field?.focus()
          }
        }}>{reason}</button
      >
    </span>
  {:else if reason}
    <span
      class="nib-bubble reason"
      aria-live="polite"
      use:hang={{ side: 'below', gap: 4 }}
      transition:fly={{ y: -4, duration: dur(120), easing: cubicOut }}>{reason}</span
    >
  {/if}
</span>

<style>
  .naming {
    position: relative;
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
  }

  input {
    width: 100%;
    min-width: 0;
    padding: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
  }

  .wrong input:focus {
    box-shadow: none;
  }

  .reason {
    position: fixed;
    z-index: var(--z-bubble);
  }

  .go {
    padding: 0;
    border: none;
    background: none;
    color: inherit;
    font: inherit;
    text-align: start;
    text-decoration: underline;
    cursor: pointer;
  }
</style>

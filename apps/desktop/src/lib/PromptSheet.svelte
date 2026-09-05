<script lang="ts">
  import { closeOnBack } from './backstack.svelte'
  import { fade, scale } from 'svelte/transition'
  import { cubicOut } from 'svelte/easing'
  import { t } from './i18n.svelte'
  import { prompt } from './prompt.svelte'
  import { selectAll } from './select-all'
  import Select from './Select.svelte'

  // Back answers the question with nothing, the same as tapping away.
  $effect(() => closeOnBack(prompt.open, () => prompt.dismiss()))
</script>

{#if prompt.open}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="scrim" transition:fade={{ duration: 130 }} onclick={() => prompt.dismiss()}></div>

  <div class="sheet" transition:scale={{ duration: 190, start: 0.97, easing: cubicOut }}>
    <form
      onsubmit={(event) => {
        event.preventDefault()
        prompt.submit()
      }}
    >
      <p class="title">{prompt.title}</p>

      {#if prompt.mode === 'text'}
        <!-- Selected, so a rename can be typed straight over. -->
        <input
          bind:value={prompt.value}
          placeholder={prompt.placeholder}
          spellcheck="false"
          onkeydown={(event) => event.key === 'Escape' && prompt.dismiss()}
          use:selectAll
        />

        <!-- Only worth asking when there is more than one answer. -->
        {#if prompt.spaces.length > 1}
          <div class="field">
            <span class="label">{t('Space')}</span>
            <Select
              value={prompt.space ?? ''}
              options={prompt.spaces.map((one) => ({ value: one.id, label: one.name }))}
              onchange={(id) => (prompt.space = id)}
              label={t('Space')}
            />
          </div>
        {/if}
      {:else if prompt.detail}
        <p class="detail">{prompt.detail}</p>
      {/if}

      <div class="row">
        {#if prompt.mode === 'choose'}
          {#each prompt.options as option (option.id)}
            <button
              type="button"
              class:primary={option.primary}
              class:danger={option.danger}
              class:quiet={!option.primary && !option.danger}
              onclick={() => prompt.pick(option.id)}
            >
              {t(option.label)}
            </button>
          {/each}
        {:else}
          <button type="button" class="quiet" onclick={() => prompt.dismiss()}>{t('Cancel')}</button>
          <button
            type="submit"
            class="primary"
            class:danger={prompt.danger}
            disabled={prompt.mode === 'text' && !prompt.value.trim()}
          >
            {t(prompt.confirmLabel)}
          </button>
        {/if}
      </div>
    </form>
  </div>
{/if}

<svelte:window onkeydown={(event) => prompt.open && event.key === 'Escape' && prompt.dismiss()} />

<style>
  .scrim {
    position: fixed;
    inset: 0;
    background: color-mix(in srgb, var(--bg) 62%, transparent);
    backdrop-filter: blur(3px);
    z-index: 50;
  }

  .sheet {
    position: fixed;
    top: 22vh;
    left: 50%;
    translate: -50% 0;
    width: min(22rem, calc(100vw - 3rem));
    z-index: 51;
    padding: var(--space-5);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
  }

  .title {
    margin: 0;
    font-size: var(--text-base);
    font-weight: 550;
    color: var(--text-strong);
  }

  .detail {
    margin: 0;
    font-size: var(--text-sm);
    line-height: 1.5;
    color: var(--muted-strong);
  }

  input {
    width: 100%;
    padding: 10px 12px;
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

  .row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .label {
    font-size: var(--text-sm);
    color: var(--muted);
  }

  button {
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius-md);
    font-family: var(--font-ui);
    font-size: var(--text-sm);
    font-weight: 550;
    cursor: default;
    transition:
      background var(--dur-fast) var(--ease-out),
      color var(--dur-fast) var(--ease-out);
  }

  .primary {
    background: var(--accent);
    color: #fff;
  }

  .primary:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .primary:active:not(:disabled) {
    background: var(--accent-press);
  }

  .danger {
    background: var(--danger);
    color: #fff;
  }

  .danger:hover {
    filter: brightness(1.08);
  }

  .primary:disabled {
    opacity: 0.5;
  }

  .quiet {
    background: none;
    color: var(--muted);
  }

  .quiet:hover {
    background: var(--surface-2);
    color: var(--text-strong);
  }

  .quiet:active {
    background: var(--press);
    color: var(--text-strong);
  }

  .danger:active {
    background: color-mix(in srgb, var(--danger) 82%, black);
    filter: none;
  }

  @media (max-width: 720px) {
    .sheet {
      top: auto;
      bottom: 0;
      left: 0;
      translate: none;
      width: 100%;
      max-height: 88dvh;
      border-radius: var(--radius-lg) var(--radius-lg) 0 0;
      padding-bottom: calc(var(--space-4) + env(safe-area-inset-bottom));
    }
  }
</style>

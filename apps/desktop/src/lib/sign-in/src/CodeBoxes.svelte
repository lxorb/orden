<script lang="ts">
  let { value = $bindable('') }: { value?: string } = $props()
  const LENGTH = 6
  let field = $state<HTMLInputElement>()
  let within = $state(false)
  const at = $derived(Math.min(value.length, LENGTH - 1))
  export function focus() {
    field?.focus()
  }
  function taken(event: Event) {
    const input = event.target as HTMLInputElement
    value = input.value.replace(/\D/g, '').slice(0, LENGTH)
    input.value = value
  }
  function atEnd() {
    field?.setSelectionRange(value.length, value.length)
  }
</script>

<div class="digits" class:within dir="ltr">
  <input
    bind:this={field}
    {value}
    oninput={taken}
    onfocus={() => {
      within = true
      atEnd()
    }}
    onblur={() => (within = false)}
    onselect={atEnd}
    inputmode="numeric"
    autocomplete="one-time-code"
    maxlength={LENGTH}
    aria-label="Sign-in code"
  />
  {#each { length: LENGTH }, index (index)}
    <span class="box" class:at={within && index === at} aria-hidden="true">{value.charAt(index)}</span>
  {/each}
</div>

<style>
  .digits {
    position: relative;
    display: inline-flex;
    gap: 8px;
  }
  input {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    margin: 0;
    padding: 0;
    border: 0;
    opacity: 0;
    font-size: 16px;
  }
  .box {
    display: grid;
    place-items: center;
    width: 46px;
    height: 56px;
    font-size: 22px;
    font-weight: 600;
    border-radius: 12px;
    border: 1px solid var(--line-strong);
    background: var(--card, var(--bg));
    color: var(--text);
    font-family: var(--font-ui);
    font-variant-numeric: tabular-nums;
  }
  .box.at {
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 28%, transparent);
  }
  @media (max-width: 640px) {
    .box {
      width: 40px;
      height: 50px;
    }
  }
</style>

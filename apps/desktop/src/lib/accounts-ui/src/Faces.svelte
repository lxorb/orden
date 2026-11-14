<script lang="ts">
  import Avatar from './Avatar.svelte'
  import { people } from '../../accounts/src/api'

  const { ids, most = 3 }: { ids: readonly string[]; most?: number } = $props()

  const shown = $derived(
    ids
      .slice(0, most)
      .map((id) => ({ id, person: people.of(id) }))
      .filter((one) => one.person !== undefined),
  )
</script>

<span class="faces" aria-hidden="true">
  {#each shown as { id, person } (id)}
    {#if person}
      <span class="one">
        <Avatar face={{ name: person.name, avatar: person.avatar, key: id }} size={16} />
      </span>
    {/if}
  {/each}
</span>

<style>
  .faces {
    flex: none;
    display: inline-flex;
    align-items: center;
  }

  .one {
    display: inline-flex;
    border-radius: 50%;
    box-shadow: 0 0 0 1.5px var(--avatar-ring, var(--surface));
  }

  .one + .one {
    margin-inline-start: -5px;
  }
</style>

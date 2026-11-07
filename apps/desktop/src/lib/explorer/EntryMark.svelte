<script lang="ts">
  import { fileMark } from '../file-mark'
  import FileMark from '../FileMark.svelte'
  import { kindIcons } from './kind-icons'

  const { name, folder }: { name: string | null; folder: boolean } = $props()

  const mark = $derived(name === null || folder ? 'folder' : fileMark(name))
  const icon = $derived(mark === 'file' && name !== null ? kindIcons.of(name) : null)
</script>

{#if icon}
  <span class="mark" aria-hidden="true">
    <img src={icon} alt="" draggable="false" />
  </span>
{:else}
  <FileMark {mark} />
{/if}

<style>
  span {
    display: block;
    flex: none;
    width: var(--icon-md);
    height: var(--icon-md);
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
</style>

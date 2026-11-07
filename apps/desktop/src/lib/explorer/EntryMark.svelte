<script lang="ts">
  import { fileMark } from '../file-mark'
  import FileMark from '../FileMark.svelte'
  import { nameOf } from '../space-paths'
  import { kindIcons } from './kind-icons'
  import { ordenOpens } from './open'

  const { path, folder }: { path: string | null; folder: boolean } = $props()

  const own = $derived(path === null || folder || ordenOpens(path))
  const icon = $derived(own || path === null ? null : kindIcons.of(nameOf(path)))
  const mark = $derived(path === null || folder ? 'folder' : fileMark(nameOf(path)))
</script>

{#if icon}
  <span class="mark" aria-hidden="true">
    <img src={icon} alt="" draggable="false" />
  </span>
{:else}
  <FileMark mark={own ? mark : 'file'} />
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

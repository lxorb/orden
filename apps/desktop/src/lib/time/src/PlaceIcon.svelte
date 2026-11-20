<script lang="ts">
  import { webPages } from '@orden/contracts'
  import { Icon, iconLibrary } from '../../glyphs/src/api'
  import { FileMark, fileMark } from '../../marks/src/api'
  import { initial, readIcon } from '../../ui-kit/src/api'
  import { sync } from '../../sync-store/src/api'
  import { workspace } from '../../workspace/src/api'
  import { appIcons } from './app-icons.svelte'
  import { placeTint } from './look'
  import { appIcon, lightness, plateFor, siteIcon, UNSEEN } from './places'
  import { theme } from '../../theme/src/api'
  import { lightOf, measured } from './lights.svelte'
  import type { Lane } from './records'

  const { lane, place, name }: { lane: Lane; place: string; name: string } = $props()
  const brand = $derived(
    readIcon(lane === 'app' ? (appIcon(place) ?? appIcon(name)) : lane === 'site' ? siteIcon(place) : null),
  )
  const drawn = $derived(iconLibrary.drawing(brand) !== null)
  const pictures = $derived.by(() => {
    if (lane === 'site') {
      const cached = webPages().faviconOf(`https://${place}`)
      return [...(cached ? [cached] : []), `https://${place}/favicon.ico`]
    }
    if (lane === 'app') {
      const held = appIcons.of(place) ?? appIcons.of(name)
      return held ? [held] : []
    }
    return []
  })
  let missed = $state<string[]>([])
  let shown = $state<string | null>(null)
  const picture = $derived(pictures.find((one) => !missed.includes(one)) ?? null)
  const plate = $derived(shown === picture && picture !== null ? plateFor(lightOf(picture), theme.current) : null)
  function loaded(image: HTMLImageElement) {
    image.classList.add('ready')
    shown = image.getAttribute('src')
    const src = shown
    if (src === null || measured(src)) return
    try {
      const canvas = document.createElement('canvas')
      canvas.width = 16
      canvas.height = 16
      const pen = canvas.getContext('2d')
      if (!pen) return
      pen.drawImage(image, 0, 0, 16, 16)
      measured(src, lightness(pen.getImageData(0, 0, 16, 16).data))
    } catch {
      measured(src, UNSEEN)
    }
  }
  $effect(() => {
    const set = iconLibrary.setFor(brand)
    if (set !== null) iconLibrary.load(set)
  })
  const space = $derived(
    lane === 'space'
      ? (workspace.spaces.find((one) => sync.remoteIdFor(one.root) === place || `name:${one.name}` === place) ?? null)
      : null,
  )
  const spaceIcon = $derived(space ? readIcon(workspace.iconFor(space.id)) : null)
  const path = $derived(lane === 'tab' && /^([/\\]|[A-Za-z]:)/.test(place) ? place : null)
</script>

<span class="icon" style:--tint={placeTint(place)} aria-hidden="true" data-time-place-icon>
  {#if picture}
    {#if brand && drawn}
      <span class="glyph"><Icon icon={brand} /></span>
    {:else}
      <span class="tile">{initial(name)}</span>
    {/if}
    {#key picture}
      <img
        src={picture}
        alt=""
        draggable="false"
        class:plate={plate !== null}
        class:dark-plate={plate === 'dark'}
        data-time-plate={plate ?? undefined}
        onload={(event) => {
          if (event.currentTarget instanceof HTMLImageElement) loaded(event.currentTarget)
        }}
        onerror={() => (missed = [...missed, picture])}
      />
    {/key}
  {:else if brand && drawn}
    <span class="glyph"><Icon icon={brand} /></span>
  {:else if space && spaceIcon}
    <span class="glyph"><Icon icon={spaceIcon} tint={workspace.tintFor(space.id)} /></span>
  {:else if lane === 'tab'}
    <span class="file"><FileMark mark={fileMark(path ?? name)} path={path ?? undefined} /></span>
  {:else}
    <span class="tile">{initial(name)}</span>
  {/if}
</span>

<style>
  .icon {
    flex: none;
    display: inline-grid;
    place-items: center;
    width: 16px;
    height: 16px;
    color: var(--muted-strong);
    --icon-md: 16px;
  }
  img,
  .glyph,
  .file {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
  }
  img {
    position: relative;
    border-radius: 3px;
    object-fit: cover;
    opacity: 0;
  }
  img:global(.ready) {
    opacity: 1;
  }
  .plate {
    padding: 1px;
    border-radius: 4px;
    background: color-mix(in srgb, white 88%, var(--surface));
  }
  .dark-plate {
    background: color-mix(in srgb, black 80%, var(--surface));
  }
  .icon > * {
    grid-area: 1 / 1;
  }
  img:not([src]),
  img[src=''] {
    display: none;
  }
  .tile {
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 4px;
    background: color-mix(in srgb, var(--tint) 30%, var(--surface));
    color: var(--text-strong);
    font-size: 10px;
    font-weight: var(--weight-strong);
    line-height: 1;
  }
</style>

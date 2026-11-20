<script lang="ts">
  import { portOf, type SiteIconsHeld, webPages } from '@orden/contracts'
  import { Icon, iconLibrary } from '../../glyphs/src/api'
  import { FileMark, fileMark, SpaceMark, TabMark } from '../../marks/src/api'
  import { TAB_KINDS } from '../../tab-kinds/src/api'
  import { initial, readIcon } from '../../ui-kit/src/api'
  import { sync } from '../../sync-store/src/api'
  import { workspace } from '../../workspace/src/api'
  import { appIcons } from './app-icons.svelte'
  import { placeTint } from './look'
  import { appIcon, lightness, OWN_ICON, ownApp, plateFor, siteIcon, tabKindOf, UNSEEN } from './places'
  import { siteOf, tabPlace } from './tracker'
  import { theme } from '../../theme/src/api'
  import { lightOf, measured } from './lights.svelte'
  import type { Lane } from './records'

  const { lane, place, name }: { lane: Lane; place: string; name: string } = $props()
  const brand = $derived(
    readIcon(lane === 'app' ? (appIcon(place) ?? appIcon(name)) : lane === 'site' ? siteIcon(place) : null),
  )
  const drawn = $derived(iconLibrary.drawing(brand) !== null)
  let sites = $state<SiteIconsHeld | null>(null)
  $effect(() => {
    if (lane !== 'site') return
    const port = portOf('web.siteIcons')
    if (port.ok) void port.value.held().then((held) => (sites = held))
  })
  $effect(() => {
    if (lane === 'app') appIcons.seen(place)
  })
  const pictures = $derived.by(() => {
    if (lane === 'site') {
      const cached = webPages().faviconOf(`https://${place}`)
      const kept = sites?.picture(place) ?? null
      const live = workspace.tabs
        .filter((tab) => tab.kind === 'web' && !tab.inPrivate && siteOf(tab.address) === place)
        .map((tab) => webPages().of(tab.id).icon)
        .find((icon) => icon !== null)
      return [cached, kept, live ?? null, `https://${place}/favicon.ico`].filter((one): one is string => !!one)
    }
    if (lane === 'app') {
      const held = appIcons.of(place) ?? appIcons.of(name)
      return [held, ownApp(place) || ownApp(name) ? OWN_ICON : null].filter((one): one is string => !!one)
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
  $effect(() => {
    const set = iconLibrary.setFor(spaceIcon)
    if (set !== null) iconLibrary.load(set)
  })
  const liveTab = $derived(lane === 'tab' ? (workspace.tabs.find((tab) => tabPlace(tab)?.key === place) ?? null) : null)
  const kind = $derived(lane === 'tab' ? tabKindOf(place) : null)
  const kindMark = $derived(kind ? (TAB_KINDS[kind].mark ?? null) : null)
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
  {:else if space}
    <span class="space" data-time-space-mark><SpaceMark id={space.id} name={space.name} /></span>
  {:else if liveTab}
    <span class="file" data-time-tab-mark><TabMark tab={liveTab} /></span>
  {:else if lane === 'tab'}
    <span class="file" data-time-kind-mark={kind ?? ''}
      ><FileMark mark={kindMark ?? fileMark(path ?? name)} path={path ?? undefined} /></span
    >
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
  .file,
  .space {
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
  .space {
    font-size: 10px;
    font-weight: var(--weight-strong);
    color: var(--text-strong);
    --icon-md: 16px;
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

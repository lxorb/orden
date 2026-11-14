const KEEP = 32

const RATIO = 9 / 16

interface Kept {
  shot: string
  still: Promise<string>
}

const kept = new Map<string, Kept>()

export function stillOf(tabId: string, shot: string, width: number): Promise<string> {
  const known = kept.get(tabId)
  if (known?.shot === shot) return known.still

  const still = made(shot, width)
  kept.delete(tabId)
  kept.set(tabId, { shot, still })
  const oldest = kept.keys().next().value
  if (kept.size > KEEP && oldest !== undefined) kept.delete(oldest)
  return still
}

async function made(shot: string, width: number): Promise<string> {
  try {
    const page = new Image()
    page.src = shot
    await page.decode()

    const wide = Math.round(width * (window.devicePixelRatio || 1))
    const tall = Math.round(wide * RATIO)
    const canvas = document.createElement('canvas')
    canvas.width = wide
    canvas.height = tall
    const paint = canvas.getContext('2d')
    if (!paint || page.naturalWidth === 0) return shot

    const at = drawn(page.naturalWidth, page.naturalHeight, wide, tall)
    paint.imageSmoothingQuality = 'high'
    paint.drawImage(page, at.x, 0, at.width, at.height)

    const still = canvas.toDataURL('image/jpeg', 0.86)
    const ready = new Image()
    ready.src = still
    await ready.decode()
    return still
  } catch {
    return shot
  }
}

export function drawn(
  width: number,
  height: number,
  wide: number,
  tall: number,
): { x: number; width: number; height: number } {
  const scale = Math.max(wide / width, tall / height)
  return { x: (wide - width * scale) / 2, width: width * scale, height: height * scale }
}

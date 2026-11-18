;(function () {
  if (window.top !== window) return
  const former = /* __FORMER__ */ null
  window.__ORDEN_FORMER__ = former
  if (!former || former.waiting) return
  let storage
  try {
    storage = window.localStorage
  } catch {
    return
  }
  const CARRIED = 'orden:home-carried'
  const MOVED = 'orden:roots-moved'
  const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)
  const parse = (text) => {
    if (text === null) return null
    try {
      return JSON.parse(text)
    } catch {
      return null
    }
  }
  const joined = (moved, there) => {
    if (Array.isArray(moved) && Array.isArray(there)) {
      const seen = new Set(there.map((one) => JSON.stringify(one)))
      return [...there, ...moved.filter((one) => !seen.has(JSON.stringify(one)))]
    }
    if (!isRecord(moved) || !isRecord(there)) return there
    const out = { ...moved }
    for (const [key, value] of Object.entries(there)) {
      out[key] = key in moved ? joined(moved[key], value) : value
    }
    return out
  }
  const pathMoved = (text, was, now) =>
    text === was ? now : text.split(`${was}/`).join(`${now}/`).split(`${was}\\`).join(`${now}\\`)
  const valueMoved = (value, was, now) => {
    if (typeof value === 'string') return pathMoved(value, was, now)
    if (Array.isArray(value)) {
      const kept = value.map((one) => ({ one, moved: valueMoved(one, was, now) }))
      const there = new Set(
        kept.filter(({ one, moved }) => one === moved).map(({ one }) => JSON.stringify(one)),
      )
      return kept
        .filter(({ one, moved }) => one === moved || !there.has(JSON.stringify(moved)))
        .map(({ moved }) => moved)
    }
    if (!isRecord(value)) return value
    const out = {}
    const movedKeys = []
    for (const [key, one] of Object.entries(value)) {
      const after = pathMoved(key, was, now)
      const moved = valueMoved(one, was, now)
      if (after === key) out[key] = moved
      else movedKeys.push([after, moved])
    }
    for (const [key, moved] of movedKeys) out[key] = key in out ? joined(moved, out[key]) : moved
    return out
  }
  const keys = () => {
    const out = []
    for (let at = 0; at < storage.length; at += 1) {
      const key = storage.key(at)
      if (key !== null && key.startsWith('orden:')) out.push(key)
    }
    return out
  }
  try {
    if (typeof former.after === 'string') {
      const said = parse(former.after)
      for (const [key, value] of Object.entries(isRecord(said) ? said : {})) {
        if (typeof value !== 'string' || key === CARRIED) continue
        const had = storage.getItem(key)
        const before = parse(had)
        const after = parse(value)
        const both = typeof before === 'object' && before !== null && typeof after === 'object'
        const next =
          had !== null && both && after !== null ? JSON.stringify(joined(before, after)) : value
        if (next !== had) storage.setItem(key, next)
      }
    }
    if (!former.homes.length || storage.getItem(CARRIED) !== null) return
    for (const { from, to } of former.homes) {
      const escaped = JSON.stringify(from).slice(1, -1)
      for (const key of keys()) {
        if (key === MOVED || key === CARRIED) continue
        const text = storage.getItem(key)
        if (text === null || (!text.includes(from) && !text.includes(escaped))) continue
        const value = parse(text)
        const moved =
          value === null ? pathMoved(text, from, to) : JSON.stringify(valueMoved(value, from, to))
        if (moved === text) continue
        storage.setItem(key, moved)
      }
    }
    const noted = parse(storage.getItem(MOVED))
    const before = (Array.isArray(noted) ? noted : []).filter(
      (one) => !former.homes.some((home) => home.from === one?.from),
    )
    if (former.homes.length) storage.setItem(MOVED, JSON.stringify([...before, ...former.homes]))
    storage.setItem(CARRIED, '1')
    former.carried = true
  } catch {
    former.carried = false
  }
})()

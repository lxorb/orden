;(function () {
  if (window.top !== window) return
  const kept = /* kept */ { values: {}, gone: [] }
  let storage
  try {
    storage = window.localStorage
  } catch {
    return
  }
  const set = Storage.prototype.setItem
  const remove = Storage.prototype.removeItem
  const clear = Storage.prototype.clear

  const DONE = 'nib:kept-restored'
  let done = false
  try {
    done = window.sessionStorage.getItem(DONE) === '1'
    window.sessionStorage.setItem(DONE, '1')
  } catch {
    // No session storage: put back once more, which is what kept still says.
  }
  if (!done) {
    for (const [key, value] of Object.entries(kept.values)) {
      if (storage.getItem(key) !== value) set.call(storage, key, value)
    }
    for (const key of kept.gone) {
      if (storage.getItem(key) !== null) remove.call(storage, key)
    }
  }

  function tell(command, args) {
    const internals = window.__TAURI_INTERNALS__
    if (!internals || typeof internals.invoke !== 'function') return
    internals.invoke(command, args).catch(() => undefined)
  }

  Storage.prototype.setItem = function (key, value) {
    set.call(this, key, value)
    if (this === storage) tell('kept_write', { key: String(key), value: String(value) })
  }
  Storage.prototype.removeItem = function (key) {
    remove.call(this, key)
    if (this === storage) tell('kept_forget', { key: String(key) })
  }
  Storage.prototype.clear = function () {
    if (this === storage) {
      for (let at = this.length - 1; at >= 0; at -= 1) tell('kept_forget', { key: this.key(at) })
    }
    clear.call(this)
  }
})()

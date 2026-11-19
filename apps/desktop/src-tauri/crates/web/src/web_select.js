;(function () {
  if (window.top !== window) return
  const picks = new Map()
  let next = 1
  const mac = /Mac/.test(navigator.platform)
  const single = function (one) {
    return one instanceof HTMLSelectElement && !one.multiple && one.size <= 1 && !one.disabled
  }
  const tell = function (select) {
    const box = select.getBoundingClientRect()
    const options = Array.from(select.options, function (option, index) {
      const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement : null
      return {
        index: index,
        label: option.label || option.text,
        disabled: option.disabled || (group !== null && group.disabled),
        group: group === null ? null : group.label,
      }
    })
    const id = next++
    picks.clear()
    picks.set(id, select)
    const bound = globalThis.ordenSelect
    if (typeof bound === 'function') {
      bound(
        JSON.stringify({
          id: id,
          x: box.x,
          y: box.y,
          width: box.width,
          height: box.height,
          selected: select.selectedIndex,
          options: options,
        }),
      )
    }
  }
  addEventListener('mousedown', function (event) {
    if (event.defaultPrevented || event.button !== 0 || !event.isTrusted) return
    const select = event.target instanceof Element ? event.target.closest('select') : null
    if (!single(select)) return
    event.preventDefault()
    select.focus()
    tell(select)
  })
  addEventListener('keydown', function (event) {
    if (event.defaultPrevented || !event.isTrusted || !single(event.target)) return
    const arrow = event.key === 'ArrowDown' || event.key === 'ArrowUp'
    const plain = !event.altKey && !event.ctrlKey && !event.metaKey
    const opens =
      (event.altKey && arrow) ||
      event.key === 'F4' ||
      (plain && (event.key === ' ' || event.key === 'Enter')) ||
      (mac && plain && arrow)
    if (!opens) return
    event.preventDefault()
    tell(event.target)
  })
  globalThis.ordenSelectPick = function (id, index) {
    const select = picks.get(id)
    picks.delete(id)
    if (!select || !select.isConnected) return false
    select.focus()
    if (index === null) return true
    const option = select.options[index]
    if (!option || option.disabled) return false
    if (select.selectedIndex !== index) {
      select.selectedIndex = index
      select.dispatchEvent(new Event('input', { bubbles: true, composed: true }))
      select.dispatchEvent(new Event('change', { bubbles: true }))
    }
    return true
  }
})()

;((last) => {
  const stops = [
    ...document.querySelectorAll(
      'a[href], area[href], button, input, select, textarea, iframe, summary, [tabindex], [contenteditable]',
    ),
  ].filter((one) => one.tabIndex >= 0 && !one.closest('[inert]'))
  const ordered = [
    ...stops.filter((one) => one.tabIndex > 0).sort((one, other) => one.tabIndex - other.tabIndex),
    ...stops.filter((one) => one.tabIndex === 0),
  ]
  if (last) ordered.reverse()
  for (const one of ordered) {
    one.focus({ focusVisible: true })
    if (document.activeElement === one) return
  }
  document.activeElement?.blur?.()
})(globalThis.ordenIntoLast === true)

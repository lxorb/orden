import { copySelection, cutSelection } from './ui-controls/src/api'
import { showCombination, DIVIDER, type MenuEntry, walkableRows } from './ui-kit/src/api'
import { menu, type TextField } from './menu.svelte'
import { shortcuts } from './shortcuts.svelte'
import { walked } from './walk'

export function showFieldMenu(event: MouseEvent, field: TextField): void {
  menu.show(event, fieldEntries(field), { keepFocus: true })
  window.removeEventListener('keydown', onKey, true)
  window.addEventListener('keydown', onKey, true)
}

const MODIFIERS = ['Shift', 'Control', 'Alt', 'Meta']

function onKey(event: KeyboardEvent): void {
  if (!menu.open || !menu.keepFocus) {
    window.removeEventListener('keydown', onKey, true)
    return
  }
  if (MODIFIERS.includes(event.key)) return

  const took = () => {
    event.preventDefault()
    event.stopImmediatePropagation()
  }
  const stops = walkableRows(menu.items)
  const at = stops.indexOf(menu.lit)
  const moved = walked(event.key, at < 0 ? null : at, stops.length, true)
  if (moved !== null) {
    took()
    menu.lit = stops[moved] ?? -1
    return
  }

  const row = menu.items[menu.lit]
  if (event.key === 'Escape' || event.key === 'Enter' || (event.key === ' ' && row)) took()
  menu.hide()
  if ((event.key === 'Enter' || event.key === ' ') && row) row.run()
}

function selects(field: TextField): boolean {
  const { selectionStart: from, selectionEnd: to } = field
  return from === null || to === null || from !== to
}

export function fieldEntries(field: TextField): MenuEntry[] {
  const locked = field.readOnly || field.disabled
  const secret = field instanceof HTMLInputElement && field.type === 'password'
  const selected = selects(field)

  return [
    {
      label: 'Cut',
      hint: shortcuts.hint('fixed.cut'),
      disabled: !selected || locked || secret,
      run: cutSelection,
    },
    {
      label: 'Copy',
      hint: shortcuts.hint('fixed.copy'),
      disabled: !selected || secret,
      run: copySelection,
    },
    {
      label: 'Paste',
      hint: shortcuts.hint('fixed.paste'),
      disabled: locked,
      run: () => void pasteInto(field),
    },
    DIVIDER,
    {
      label: 'Select all',
      hint: showCombination('Mod-a', shortcuts.platform),
      disabled: field.value === '',
      run: () => field.select(),
    },
  ]
}

async function pasteInto(field: TextField): Promise<void> {
  const text = await navigator.clipboard.readText().catch(() => '')
  if (!text) return

  field.focus()
  // eslint-disable-next-line @typescript-eslint/no-deprecated -- the only edit a field's own undo keeps
  if (document.execCommand('insertText', false, text)) return

  const end = field.value.length
  try {
    field.setRangeText(text, field.selectionStart ?? end, field.selectionEnd ?? end, 'end')
  } catch {
    field.value += text
  }
  field.dispatchEvent(new Event('input', { bubbles: true }))
}

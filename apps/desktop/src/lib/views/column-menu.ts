import {
  DEFAULT_SUMMARIES,
  idRepairs,
  inBase,
  isButton,
  readRollup,
  reverseFormula,
} from '@orden/bases'
import { i18n, t } from '../i18n.svelte'
import { DIVIDER, menu, type MenuEntry } from '../menu.svelte'
import { writeEach } from './act'
import {
  bare,
  displayName,
  formatOf,
  isNoteProperty,
  knownProperties,
  reverseOffers,
} from './columns'
import {
  freeFormulaName,
  setBaseOrden,
  setColumns,
  setFormula,
  setProperty,
  setSort,
  setSummary,
  setViewOrden,
} from './edit'
import { FORMATS } from './format'
import type { Kit } from './kit'
import { optionsAt, optionsFor, valuesOf } from './options'
import { propertyName, summaryName } from './words'

function formatName(format: string): string {
  if (format.startsWith('currency:')) {
    const code = format.slice(9)
    try {
      return (
        new Intl.NumberFormat(i18n.language, { style: 'currency', currency: code })
          .formatToParts(0)
          .find((part) => part.type === 'currency')?.value ?? code
      )
    } catch {
      return code
    }
  }
  switch (format) {
    case 'number':
      return t('Number with separators')
    case 'percent':
      return t('Percent')
    case 'progress':
      return t('Progress')
    case 'url':
      return t('Web address')
    case 'email':
      return t('Email')
    default:
      return t('Phone')
  }
}

const keyOf = (column: string) => (column.startsWith('formula.') ? column.slice(8) : bare(column))

function additions(kit: Kit, columns: readonly string[]): MenuEntry[] {
  const live = kit.live
  const base = live.base
  if (!base) return []
  const kinds = live.view?.orden.rows ?? 'notes'
  const add = (column: string) => kit.change((b, at) => setColumns(b, at, [...columns, column]))
  const others = knownProperties(base, kinds, live.rows)
    .filter((one) => !columns.includes(one))
    .map((one) => ({ label: propertyName(one, displayName(base, one)), run: () => add(one) }))
  if (kinds !== 'notes') return others

  const shown = live.answer?.groups.flatMap((group) => group.rows) ?? []
  const reverse = reverseOffers(base, shown, live.rows, live.context).map((offer) => ({
    label: `← ${offer.name}`,
    run: () => {
      const name = freeFormulaName(base, offer.name)
      kit.change((b, at) =>
        setColumns(setFormula(b, name, reverseFormula(offer.property)), at, [
          ...columns,
          `formula.${name}`,
        ]),
      )
    },
  }))
  const ids = base.orden.id
    ? []
    : [
        {
          label: t('Unique ID'),
          run: () => {
            if (live.locked) {
              live.refused++
              return
            }
            const property = 'id'
            kit.change((b, at) =>
              setColumns(setBaseOrden(b, 'id', { property, prefix: '' }), at, [
                ...columns,
                `note.${property}`,
              ]),
            )
            const own = live.rows.filter((row) => inBase(base, row, live.context))
            void writeEach(
              idRepairs(own, property, '').map(({ row, id }) => ({
                row,
                change: { note: { [property]: id } },
              })),
            )
          },
        },
      ]
  return [
    ...others,
    DIVIDER,
    ...reverse,
    { label: t('Formula'), run: () => (live.builder = { kind: 'formula' }) },
    { label: t('Rollup'), run: () => (live.builder = { kind: 'rollup' }) },
    { label: t('Button'), run: () => (live.builder = { kind: 'button' }) },
    ...ids,
  ]
}

export function grouped(
  event: MouseEvent | undefined,
  label: string,
  more: () => Promise<MenuEntry[]>,
): MenuEntry {
  return {
    label,
    more,
    run: () => {
      if (event) void more().then((rows) => menu.show(event, rows, { title: label }))
    },
  }
}

export function columnMenu(
  kit: Kit,
  column: string,
  columns: readonly string[],
  event?: MouseEvent,
): MenuEntry[] {
  const live = kit.live
  const base = live.base
  if (!base || !kit.writable) return []
  const view = live.view
  const place = columns.indexOf(column)
  const frozen = view?.orden.freeze ?? 0
  const formula = column.startsWith('formula.') ? base.formulas[column.slice(8)] : undefined
  const note = isNoteProperty(column)
  const format = formatOf(base, column)

  return [
    {
      label: t('Ascending'),
      run: () => kit.change((b, i) => setSort(b, i, [{ property: column, direction: 'ASC' }])),
    },
    {
      label: t('Descending'),
      run: () => kit.change((b, i) => setSort(b, i, [{ property: column, direction: 'DESC' }])),
    },
    DIVIDER,
    grouped(event, t('Summary'), () =>
      Promise.resolve([
        {
          label: t('None'),
          checked: !view?.summaries[column],
          run: () => kit.change((b, i) => setSummary(b, i, column, null)),
        },
        ...DEFAULT_SUMMARIES.map((name) => ({
          label: summaryName(name),
          checked: view?.summaries[column] === name,
          run: () => kit.change((b, i) => setSummary(b, i, column, name)),
        })),
      ]),
    ),
    grouped(event, t('Add a column'), () => Promise.resolve(additions(kit, columns))),
    DIVIDER,
    ...(note
      ? [
          {
            label: t('Options'),
            checked: optionsAt(base, column).length > 0,
            run: () => {
              if (!optionsAt(base, column).length && base.orden.id?.property !== bare(column)) {
                const options = optionsFor(valuesOf(live.rows, column))
                kit.change((b) => setProperty(b, keyOf(column), { options }))
              }
              live.builder = { kind: 'options', column }
            },
          },
        ]
      : []),
    ...(note || formula !== undefined
      ? [
          grouped(event, t('Format'), () =>
            Promise.resolve([
              {
                label: t('None'),
                checked: format === undefined,
                run: () => kit.change((b) => setProperty(b, keyOf(column), { format: undefined })),
              },
              ...FORMATS.map((one) => ({
                label: formatName(one),
                checked: format === one,
                run: () => kit.change((b) => setProperty(b, keyOf(column), { format: one })),
              })),
            ]),
          ),
        ]
      : []),
    ...(formula !== undefined
      ? [
          {
            label: t('Edit'),
            run: () =>
              (live.builder = {
                kind: readRollup(formula) !== null ? 'rollup' : 'formula',
                column,
              }),
          },
        ]
      : []),
    ...(isButton(column)
      ? [{ label: t('Edit'), run: () => (live.builder = { kind: 'button', column }) }]
      : []),
    ...(view?.type === 'form' && note
      ? [
          {
            label: t('Required'),
            checked: view.orden.required?.includes(bare(column)) === true,
            run: () =>
              kit.change((b, i) => {
                const was = b.views[i]?.orden.required ?? []
                const key = bare(column)
                const next = was.includes(key) ? was.filter((one) => one !== key) : [...was, key]
                return setViewOrden(b, i, 'required', next.length ? next : undefined)
              }),
          },
        ]
      : []),
    ...(view?.type === 'table' || view?.type === undefined
      ? [
          place < frozen
            ? {
                label: t('Unfreeze'),
                run: () => kit.change((b, i) => setViewOrden(b, i, 'freeze', undefined)),
              }
            : {
                label: t('Freeze up to here'),
                run: () => kit.change((b, i) => setViewOrden(b, i, 'freeze', place + 1)),
              },
        ]
      : []),
    DIVIDER,
    { label: t('Rename'), run: () => (live.builder = { kind: 'name', column }) },
    {
      label: t('Hide'),
      disabled: columns.length < 2,
      run: () =>
        kit.change((b, i) =>
          setColumns(
            b,
            i,
            columns.filter((one) => one !== column),
          ),
        ),
    },
  ]
}

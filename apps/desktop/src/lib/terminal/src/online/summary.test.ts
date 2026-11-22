import { expect, test } from 'vitest'
import type { ServerInfo } from './calls'
import { region } from '../../../platform/src/api'
import { summaryOf } from './summary'

const SERVER: ServerInfo = {
  type: 'cx43',
  location: 'nbg1',
  cores: 8,
  memoryGb: 16,
  diskGb: 160,
  price: 14.27,
  currency: 'EUR',
  spent: 3.1,
}
const eur = (amount: number) => new Intl.NumberFormat(region(), { style: 'currency', currency: 'EUR' }).format(amount)
const kept = (words: string) => words.replaceAll(' ', '\u00a0')
test('the machine is one line of its facts and one of its cost, laid out apart, with no dot or bullet between them', () => {
  const { about, cost } = summaryOf(SERVER)
  expect(about).toEqual(['CX43', 'Nuremberg', '8\u00a0vCPU', '16\u00a0GB\u00a0RAM', '160\u00a0GB\u00a0disk'])
  expect(cost).toEqual([kept(`${eur(14.27)} a month`), kept(`${eur(3.1)} this month`)])
  for (const part of [...about, ...cost]) expect(part).not.toMatch(/[·•‧∙⋅]/)
  expect(summaryOf({ ...SERVER, spent: null }).cost).toEqual([kept(`${eur(14.27)} a month`)])
  expect(summaryOf({ ...SERVER, price: null }).cost).toEqual([])
})

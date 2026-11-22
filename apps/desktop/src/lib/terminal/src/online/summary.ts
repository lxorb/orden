import { localNumber, region } from '../../../platform/src/api'
import { cityOf, type ServerInfo } from './calls'

function money(amount: number, currency: string): string {
  return new Intl.NumberFormat(region(), { style: 'currency', currency }).format(amount)
}
const gb = (value: number) => `${localNumber(Math.round(value))} GB`
const kept = (part: string) => part.replaceAll(' ', '\u00a0')
export function summaryOf(server: ServerInfo): { about: string[]; cost: string[] } {
  const about = [
    server.type.toUpperCase(),
    ...(server.location ? [cityOf(server.location)] : []),
    `${localNumber(server.cores)} vCPU`,
    `${gb(server.memoryGb)} RAM`,
    `${gb(server.diskGb)} disk`,
  ]
  const cost =
    server.price !== null && server.currency
      ? [
          `${money(server.price, server.currency)} a month`,
          ...(server.spent !== null ? [`${money(server.spent, server.currency)} this month`] : []),
        ]
      : []
  return { about: about.map(kept), cost: cost.map(kept) }
}

import { fetchInTime } from '../api'
import { addy } from './alias-addy'
import type { AliasClient, AliasFetcher, AliasService } from './alias-http'
import { simpleLogin } from './alias-simplelogin'

export type {
  AliasAsk,
  AliasClient,
  AliasFetcher,
  AliasMade,
  AliasOptions,
  AliasService,
  AliasStats,
} from './alias-http'
export { AliasRefused } from './alias-http'

export function aliasClient(
  provider: AliasService,
  key: string,
  fetcher: AliasFetcher = (input, init) => fetchInTime(input, init),
): AliasClient {
  switch (provider) {
    case 'simplelogin':
      return simpleLogin(key, fetcher)
    case 'addy':
      return addy(key, fetcher)
  }
}

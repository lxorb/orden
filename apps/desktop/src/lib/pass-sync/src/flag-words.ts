import type { Flag } from '@orden/pass/monitor'

export function flagName(flag: Flag): string {
  return {
    compromised: 'Compromised passwords',
    weak: 'Weak passwords',
    reused: 'Reused passwords',
    inactive2fa: 'Inactive 2FA',
    excluded: 'Excluded items',
  }[flag]
}

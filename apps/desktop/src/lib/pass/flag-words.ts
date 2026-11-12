import type { Flag } from '@orden/pass/monitor'

export function flagName(flag: Flag): string {
  switch (flag) {
    case 'compromised':
      return 'Compromised passwords'
    case 'weak':
      return 'Weak passwords'
    case 'reused':
      return 'Reused passwords'
    case 'inactive2fa':
      return 'Inactive 2FA'
    case 'excluded':
      return 'Excluded items'
  }
}

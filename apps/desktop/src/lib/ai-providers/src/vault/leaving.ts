import { account } from '../../../accounts/src/api'

export async function signOut(): Promise<void> {
  await account.signOut('asked')
}

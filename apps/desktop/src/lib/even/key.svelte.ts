/** The account's OpenAI key, as this machine can know it: not at all.
 *
 *  Emil's rule, in his words: "it stays in the account, but after you set it you
 *  can't read it anymore." So there is no key in this store and no key in the app.
 *  What there is is two facts - whether one is set, and its last four characters -
 *  which is what the settings pane shows and what the bridge needs in order to know
 *  whether a question can be asked at all.
 *
 *  The two facts arrive with the settings, in the same request the app already
 *  makes at start; see modes.svelte.ts. Setting a key and taking one away are the
 *  only two things that can change them, and both answer with the new pair, so
 *  nothing here has to guess. */

import { api, type KeyState } from '../api'
import { account } from '../account.svelte'

class GlassesKey {
  /** Whether the account has a key. False until the settings have been read, which
   *  is the safe way round: the pane offers to set one and the bridge does not
   *  offer to ask. */
  set = $state(false)
  /** The last four characters, so the pane can say which key it is. */
  tail = $state('')

  /** What the account answered, from wherever it was read. */
  took(state: KeyState | undefined): void {
    if (!state) return

    this.set = state.set
    this.tail = state.tail
  }

  /** A key the reader typed or pasted. Answers what went wrong, or empty when it
   *  went in - the pane says it in the one line under the field, and there is
   *  nothing to show afterwards but "set". */
  async put(key: string): Promise<string> {
    const token = account.accountToken
    if (!token) return 'sign in first'

    try {
      this.took(await api.setAskKey(token, key.trim()))
      return ''
    } catch (error) {
      return error instanceof Error ? error.message : 'that key could not be saved'
    }
  }

  /** Takes it away. */
  async remove(): Promise<void> {
    const token = account.accountToken
    if (!token) return

    try {
      this.took(await api.removeAskKey(token))
    } catch {
      // Nothing to say: the field still shows the key as set, which is the truth.
    }
  }
}

export const glassesKey = new GlassesKey()

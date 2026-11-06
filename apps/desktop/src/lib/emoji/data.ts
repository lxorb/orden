import { door } from '@orden/markdown/door'
import { setNamed, tonedEmoji } from '../icon-sets'
import { EMOJI_SET, type IconEntry, rankIcons } from '../icons'

export interface EmojiData {
  entries: IconEntry[]
  groups: { label: string; emojis: string[] }[]
  toned: ReadonlySet<string>
}

export const emojiData: () => Promise<EmojiData> = door(async () => {
  const set = setNamed(EMOJI_SET)
  if (!set) throw new Error('no emoji set')
  const [loaded, toned] = await Promise.all([set.load(), tonedEmoji()])
  return {
    entries: loaded.entries,
    groups: loaded.groups.map((group) => ({ label: group.label, emojis: group.names })),
    toned,
  }
})

export function findEmoji(data: EmojiData, query: string): string[] {
  return rankIcons(data.entries, query, 96)
}

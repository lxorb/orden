import { isNumber, keepJson, stored, stringList } from '../stored'
import type { Tone } from './tones'

const RECENT_KEY = 'nib:emoji-recent'
const TONE_KEY = 'nib:emoji-tone'

const MOST_RECENT = 16

const STARTERS = ['👍', '❤️', '😂']

function storedTone(): Tone {
  const said = stored(TONE_KEY)
  return isNumber(said) && Number.isInteger(said) && said >= 0 && said <= 5 ? (said as Tone) : 0
}

class EmojiRecent {
  list = $state<string[]>(stringList(stored(RECENT_KEY))?.slice(0, MOST_RECENT) ?? [])
  tone = $state<Tone>(storedTone())

  first(count: number): string[] {
    return [...new Set([...this.list, ...STARTERS])].slice(0, count)
  }

  add(emoji: string): void {
    this.list = [emoji, ...this.list.filter((one) => one !== emoji)].slice(0, MOST_RECENT)
    keepJson(RECENT_KEY, this.list)
  }

  setTone(tone: Tone): void {
    this.tone = tone
    keepJson(TONE_KEY, tone)
  }
}

export const emojiRecent = new EmojiRecent()

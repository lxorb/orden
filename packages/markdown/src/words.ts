export const OPENS_MARKUP = /<(?=[A-Za-z/!?])/g

export function asWords(text: string): string {
  return text.replace(OPENING, (_, before: string) => `${before.replace(/\\/g, '\\\\')}\\<`)
}

const OPENING = new RegExp(`(\\\\*)${OPENS_MARKUP.source}`, 'g')

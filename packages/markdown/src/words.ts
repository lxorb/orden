export const OPENS_MARKUP = /<(?=[A-Za-z/!?])/g

export const asWords = (text: string): string =>
  text.replace(OPENING, (_, before: string) => `${before.replace(/\\/g, '\\\\')}\\<`)

const OPENING = new RegExp(`(\\\\*)${OPENS_MARKUP.source}`, 'g')

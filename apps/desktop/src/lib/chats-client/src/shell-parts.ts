import { type PaletteMessages, type PaletteOpenHow, registerPaletteKind } from '@orden/contracts'

const messages: PaletteMessages = {
  hits: async (words) => {
    const one = await import('./view/palette-hits')
    return one.messageHits(words)
  },
  open: (path, message, how) => void openMessage(path, message, how),
}

async function openMessage(path: string, message: string, how: PaletteOpenHow) {
  const one = await import('./view/open')
  one.openChat(path, how, message)
}

if (!__EVEN_PLUGIN__) registerPaletteKind('messages', () => Promise.resolve(messages))

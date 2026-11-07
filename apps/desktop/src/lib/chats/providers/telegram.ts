import { telegramProvider } from '@orden/chats/telegram'

export const telegram = telegramProvider(async (setup) =>
  (await import('./telegram-client')).dial(setup),
)

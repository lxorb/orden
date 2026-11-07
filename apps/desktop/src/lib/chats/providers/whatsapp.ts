import { whatsappProvider } from '@orden/chats/whatsapp'

export const whatsapp = whatsappProvider(async (wire) =>
  (await import('./whatsapp-client')).kit(wire),
)

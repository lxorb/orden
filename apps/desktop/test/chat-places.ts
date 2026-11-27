import { providePort } from '@orden/contracts'

providePort('chats.places', {
  load: () => import('../src/lib/chats-client/src/places-here.svelte').then((one) => one.placesHere),
})

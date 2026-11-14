const away = <T>(): Promise<T> => new Promise<never>(() => undefined)

export const loadPhoneTabs = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./PhoneTabs.svelte')>() : import('./PhoneTabs.svelte')

export const loadPhoneYou = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./PhoneYou.svelte')>() : import('./PhoneYou.svelte')

export const noteMore = () =>
  __EVEN_PLUGIN__ ? away<typeof import('./note-more')>() : import('./note-more')

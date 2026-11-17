import { providePort } from '@orden/contracts'

providePort('sharing.spaces', {
  listed: (still) =>
    import('./sharing/src/api').then((one) => {
      if (!still()) return
      one.rememberRoles()
      return one.sharedWithYou.load()
    }),
})

import { providePort } from '@orden/contracts'

const looks = () => import('./theme-looks/src/api')

providePort('theme.looks', {
  glassSettings: () => looks().then((one) => one.glassSettings),
  wallpaperSheet: () => looks().then((one) => one.wallpaperSheet()),
  wallpaperSettings: () => looks().then((one) => one.wallpaperSettings),
  wakeWallpaper: () => looks().then((one) => one.wallpaper.wake()),
  follow: () => looks().then((one) => one.follow()),
  landed: (tab) => looks().then((one) => one.landed(tab)),
})

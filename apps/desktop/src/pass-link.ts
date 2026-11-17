import '@orden/themes/tokens.css'
import './pass-link.css'
import { shownLink } from './lib/pass-links/src/api'

const light = matchMedia('(prefers-color-scheme: light)').matches
document.documentElement.dataset.theme = light ? 'light' : 'dark'

const root = document.getElementById('link')

if (root) {
  void shownLink(root, {
    location,
    history,
    fetch: (url, init) => fetch(url, init),
    clipboard: 'clipboard' in navigator ? navigator.clipboard : null,
    now: () => Date.now(),
  })
}

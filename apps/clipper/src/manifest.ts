/** The extension's manifest, written here rather than as JSON so that the
 *  permissions can say why they are asked for. `vite.config.ts` emits it as
 *  `manifest.json` beside the bundles.
 *
 *  Chrome's own surfaces - the tile on chrome://extensions, the shortcut list -
 *  read their words from `_locales`, which is the only mechanism they have.
 *  Everything the extension itself draws is translated through the dictionaries
 *  in `src/locales`, the same way the app does it; see `lib/i18n.svelte.ts`. */

export const manifest: chrome.runtime.ManifestV3 = {
  manifest_version: 3,
  name: '__MSG_name__',
  description: '__MSG_description__',
  default_locale: 'en',
  version: '0.1.0',

  icons: {
    16: 'icons/16.png',
    32: 'icons/32.png',
    48: 'icons/48.png',
    128: 'icons/128.png',
  },

  action: { default_popup: 'popup.html' },
  options_ui: { page: 'options.html', open_in_tab: true },
  background: { service_worker: 'background.js', type: 'module' },

  permissions: [
    // The session token, the space a clip goes to, and the language.
    'storage',
    // The three clip actions, on the page's own menu.
    'contextMenus',
    // The reader is injected into the tab the person triggered this from, and
    // only then. Nothing runs on a page nobody asked about.
    'scripting',
    'activeTab',
  ],

  // A clipped picture is fetched from wherever the article keeps it, which is
  // any host at all, and uploaded to the account so the note stops depending on
  // the site. That is the whole reason for the breadth; nibeditor.com alone
  // would leave every image a dead link the day the article moves.
  host_permissions: ['<all_urls>'],

  commands: {
    'clip-page': {
      suggested_key: { default: 'Alt+Shift+C' },
      description: '__MSG_clipPage__',
    },
    'clip-selection': {
      suggested_key: { default: 'Alt+Shift+S' },
      description: '__MSG_clipSelection__',
    },
    'clip-link': {
      suggested_key: { default: 'Alt+Shift+L' },
      description: '__MSG_clipLink__',
    },
  },
}

/** Chrome's own list of extension shortcuts, which is the only place the three
 *  keys can be changed: no extension may draw that page itself.
 *
 *  A function of its own so that a page of markup never reaches past the
 *  extension into the browser. */
export function openShortcuts(): void {
  void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' })
}

/** jsdom lays nothing out and has no `ResizeObserver`, so anything that watches an
 *  element's size - the app's own scrollbar, the palette's whole rows - threw the
 *  moment a test mounted it, and only the files that stubbed it for themselves were
 *  safe (#775). Every effect test gets an observer that never reports, which is what
 *  a page that never moves would see. A file that wants its own still sets one. */
class NoLayout {
  observe() {
    // jsdom never moves anything.
  }

  unobserve() {
    // Said above.
  }

  disconnect() {
    // Said above.
  }
}

globalThis.ResizeObserver ??= NoLayout

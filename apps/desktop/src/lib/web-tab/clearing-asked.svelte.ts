class ClearingAsked {
  tab = $state<string | null>(null)

  ask(tab: string) {
    this.tab = tab
  }

  close() {
    this.tab = null
  }
}

export const clearingAsked = new ClearingAsked()

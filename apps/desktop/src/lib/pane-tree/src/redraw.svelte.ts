class Redrawn {
  at = $state.raw<Record<string, number>>({})
  again(paneId: string) {
    this.at = { ...this.at, [paneId]: (this.at[paneId] ?? 0) + 1 }
  }
}
export const redrawn = new Redrawn()

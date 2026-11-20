class Managing {
  by = $state<string | null>(null)
  open(by: string): void {
    this.by = by
  }
  close(): void {
    this.by = null
  }
}
export const managing = new Managing()

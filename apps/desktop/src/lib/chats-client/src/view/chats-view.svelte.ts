class ChatsView {
  naming = $state<string | null>(null)
  renaming = $state<string | null>(null)
  query = $state('')
}
export const chatsView = new ChatsView()

<script lang="ts">
  /** A chat's unread mark (#1064): a dot in the accent, the one shape every list of
   *  chats and the ✦ tab draw it in. Its word is the row's name (sidebar/marks.ts), so
   *  the dot itself is hidden from a screen reader. `corner` sits it over a tab's
   *  corner. */
  const { corner = false }: { corner?: boolean } = $props()
</script>

<span class="unread" class:corner aria-hidden="true"></span>

<style>
  .unread {
    flex: none;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent);
  }

  .corner {
    position: absolute;
    top: 3px;
    inset-inline-end: 3px;
    pointer-events: none;
  }
</style>

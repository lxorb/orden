/** A Firefox profile as its files say it, for the reader's and the landing's tests:
 *  a session with two windows - one private - a pinned tab, a tab group, a tab in a
 *  container and a saved group, and the bookmark tree its daily backup holds. Shaped
 *  after Firefox's SessionStore.sys.mjs and PlacesBackups.sys.mjs. */

export const page = (url: string, title: string) => ({ entries: [{ url, title }], index: 1 })

export const SESSION = {
  version: ['sessionrestore', 1],
  windows: [
    {
      tabs: [
        { ...page('https://mail.example.com/', 'Mail'), pinned: true },
        {
          entries: [
            { url: 'https://news.example.com/', title: 'News' },
            { url: 'https://news.example.com/today', title: 'News today' },
          ],
          index: 2,
        },
        { ...page('https://docs.example.com/guide', 'The guide'), groupId: 'g1' },
        { ...page('about:preferences', 'Settings'), groupId: 'g1' },
        { ...page('https://docs.example.com/api', 'API: reference'), groupId: 'g1' },
        { ...page('https://bank.example.com/', 'Bank'), userContextId: 2 },
        { ...page('https://later.example.com/', 'Later'), groupId: 'g2' },
      ],
      groups: [
        { id: 'g1', name: 'Docs', color: 'blue', collapsed: false },
        { id: 'g2', name: '', color: 'red', collapsed: true },
      ],
    },
    { isPrivate: true, tabs: [page('https://secret.example.com/', 'Secret')] },
  ],
  savedGroups: [
    {
      id: 's1',
      name: 'Trip',
      color: 'green',
      tabs: [
        { state: page('https://flights.example.com/', 'Flights') },
        { state: page('https://hotel.example.com/', 'Hotel') },
      ],
    },
  ],
}

const bookmark = (uri: string, title: string, guid: string) => ({
  guid,
  title,
  typeCode: 1,
  uri,
  dateAdded: 1_700_000_000_000_000,
})

export const BOOKMARKS = {
  guid: 'root________',
  title: '',
  typeCode: 2,
  children: [
    {
      guid: 'menu________',
      title: 'menu',
      typeCode: 2,
      children: [
        { guid: 'sep', typeCode: 3 },
        bookmark('https://recipes.example.com/', 'Recipes', 'b1'),
        bookmark('javascript:void(0)', 'A bookmarklet', 'b2'),
      ],
    },
    {
      guid: 'toolbar_____',
      title: 'toolbar',
      typeCode: 2,
      children: [
        {
          guid: 'f1',
          title: 'Work',
          typeCode: 2,
          children: [
            bookmark('https://board.example.com/', 'Board', 'b3'),
            { guid: 'f2', title: 'Nothing', typeCode: 2, children: [] },
          ],
        },
        bookmark('https://news.example.com/', 'News', 'b4'),
      ],
    },
    { guid: 'unfiled_____', title: 'unfiled', typeCode: 2, children: [] },
    {
      guid: 'tags________',
      title: 'tags',
      typeCode: 2,
      children: [
        {
          guid: 't1',
          title: 'cooking',
          typeCode: 2,
          children: [bookmark('https://recipes.example.com/', '', 't2')],
        },
      ],
    },
  ],
}

/** Safari's files as the crate hands them over (safari.rs), for the reader's and the
 *  landing's tests. Written by hand after Apple's own shapes, since no Mac wrote them
 *  here: `Bookmarks.plist`'s keys as Safari writes them, and `SafariTabs.db`'s rows in
 *  the layout a macOS 15.4 Safari keeps (a root, a profile, tab groups, a group's
 *  `TopScopedBookmarkList` of pinned tabs, the window's own `Local`), as DLEAPP's
 *  Safari Tabs parser read it off a public extraction. */

const leaf = (url: string, title: string, more: Record<string, unknown> = {}) => ({
  WebBookmarkType: 'WebBookmarkTypeLeaf',
  WebBookmarkUUID: `uuid-${title}`,
  URLString: url,
  URIDictionary: { title },
  ...more,
})

const folder = (title: string, children: unknown[], more: Record<string, unknown> = {}) => ({
  WebBookmarkType: 'WebBookmarkTypeList',
  WebBookmarkUUID: `uuid-${title}`,
  Title: title,
  Children: children,
  ...more,
})

export const BOOKMARKS = folder('', [
  { WebBookmarkType: 'WebBookmarkTypeProxy', Title: 'History', WebBookmarkIdentifier: 'History' },
  folder('BookmarksBar', [
    folder('Work', [leaf('https://wiki.example.com/', 'Wiki'), folder('Nothing', [])]),
    leaf('https://news.example.com/', 'News'),
  ]),
  folder('BookmarksMenu', [leaf('https://recipes.example.com/', 'Recipes')]),
  folder('Trips', [leaf('https://flights.example.com/', 'Flights')]),
  folder(
    'com.apple.ReadingList',
    [
      leaf('https://long.example.com/read', 'A long read', {
        ReadingList: { DateAdded: '2026-10-01T08:00:00Z', PreviewText: 'It begins.' },
      }),
    ],
    { ShouldOmitFromUI: true },
  ),
])

const row = (
  id: number,
  parent: number,
  type: number,
  title: string,
  url: string | null = null,
  deleted = false,
) => ({ id, parent, type, title, url, order: id, deleted })

export const TABS = [
  row(1, 0, 1, 'Root'),
  row(2, 1, 1, 'Personal'),
  row(3, 2, 1, 'Cars'),
  row(4, 3, 1, 'TopScopedBookmarkList'),
  row(5, 4, 0, 'Mail', 'https://mail.example.com/'),
  row(6, 3, 0, 'One', 'https://one.example.com/'),
  row(7, 3, 0, 'Two', 'https://two.example.com/'),
  row(8, 3, 0, 'Gone', 'https://gone.example.com/', true),
  row(9, 2, 1, 'Local'),
  row(10, 9, 0, 'Board', 'https://board.example.com/'),
  row(11, 9, 0, '', null),
  row(12, 9, 0, 'Settings', 'safari-resource:/'),
  row(13, 1, 1, 'com.apple.Safari.CloudTabs'),
  row(14, 13, 0, 'Elsewhere', 'https://elsewhere.example.com/'),
]

export const SESSION = {
  SessionVersion: '1.0',
  SessionWindows: [
    {
      TabStates: [
        { TabURL: 'https://mail.example.com/', TabTitle: 'Mail', IsAppTab: true },
        { TabURL: 'https://news.example.com/', TabTitle: 'News' },
      ],
    },
    { IsPrivateWindow: true, TabStates: [{ TabURL: 'https://secret.example.com/' }] },
  ],
}

/** Arc's `StorableSidebar.json`, for the tests: the Favorites of the first profile, two
 *  spaces of it - Personal with a pinned folder, a split view, an easel and an open
 *  tab; Work with a pinned tab - and a space of a second profile. The fields and their
 *  spelling are Arc's own, as `newContainerIDs`, `childrenIds` and the lists of ids and
 *  objects one after the other are; see arc.ts. */

const FAVORITES = 'C-TOP-DEFAULT'
const OTHER_FAVORITES = 'C-TOP-P1'

function item(
  id: string,
  parentID: string,
  data: Record<string, unknown>,
  said: Record<string, unknown> = {},
) {
  return {
    id,
    parentID,
    childrenIds: [],
    title: null,
    data,
    createdAt: 751_234_567.1,
    isUnread: false,
    originatingDevice: 'D1',
    ...said,
  }
}

function tab(id: string, parentID: string, url: string, title: string) {
  return item(id, parentID, {
    tab: {
      savedURL: url,
      savedTitle: title,
      savedMuteStatus: 'allowAudio',
      timeLastActiveAt: 751_234_999.5,
    },
  })
}

function container(id: string, kind: Record<string, unknown>, children: string[]) {
  return item(id, '', { itemContainer: { containerType: kind } }, { childrenIds: children })
}

const items = [
  container(FAVORITES, { topApps: { _0: { default: true } } }, ['F-MAIL', 'F-CAL']),
  tab('F-MAIL', FAVORITES, 'https://mail.example.com/', 'Inbox'),
  tab('F-CAL', FAVORITES, 'https://calendar.example.com/', 'Calendar'),
  container(
    OTHER_FAVORITES,
    { topApps: { _0: { custom: { _0: { directoryBasename: 'Profile 1' } } } } },
    ['F-OTHER'],
  ),
  tab('F-OTHER', OTHER_FAVORITES, 'https://other.example.com/', 'Other'),
  container('C-PERSONAL-PINNED', { spaceItems: { _0: 'S-PERSONAL' } }, [
    'P-DOCS',
    'P-NEWS',
    'P-EASEL',
  ]),
  item(
    'P-DOCS',
    'C-PERSONAL-PINNED',
    { list: {} },
    { title: 'Docs', childrenIds: ['P-SPLIT', 'P-GUIDE'] },
  ),
  item(
    'P-SPLIT',
    'P-DOCS',
    { splitView: { layoutOrientation: 'horizontal' } },
    { childrenIds: ['P-LEFT', 'P-RIGHT'] },
  ),
  tab('P-LEFT', 'P-SPLIT', 'https://left.example.com/', 'Left'),
  tab('P-RIGHT', 'P-SPLIT', 'https://right.example.com/', 'Right'),
  { ...tab('P-GUIDE', 'P-DOCS', 'https://docs.example.com/guide', 'Guide'), title: 'The guide' },
  tab('P-NEWS', 'C-PERSONAL-PINNED', 'https://news.example.com/', 'News'),
  item('P-EASEL', 'C-PERSONAL-PINNED', { easel: { easelID: 'E1' } }, { title: 'Plans' }),
  container('C-PERSONAL-OPEN', { spaceItems: { _0: 'S-PERSONAL' } }, ['O-SEARCH']),
  tab('O-SEARCH', 'C-PERSONAL-OPEN', 'https://search.example.com/?q=arc', 'arc - Search'),
  container('C-WORK-PINNED', { spaceItems: { _0: 'S-WORK' } }, ['W-BOARD']),
  tab('W-BOARD', 'C-WORK-PINNED', 'https://board.example.com/', 'Board'),
  container('C-WORK-OPEN', { spaceItems: { _0: 'S-WORK' } }, []),
  container('C-SIDE-PINNED', { spaceItems: { _0: 'S-SIDE' } }, ['X-SIDE']),
  tab('X-SIDE', 'C-SIDE-PINNED', 'https://side.example.com/', 'Side'),
]

const spaces = [
  {
    id: 'S-PERSONAL',
    title: 'Personal',
    profile: { default: true },
    customInfo: { iconType: { emoji_v2: '🏠' }, windowTheme: { semanticColorPalettes: {} } },
    newContainerIDs: [
      { pinned: {} },
      'C-PERSONAL-PINNED',
      { unpinned: { _0: { shared: {} } } },
      'C-PERSONAL-OPEN',
    ],
    containerIDs: ['pinned', 'C-PERSONAL-PINNED', 'unpinned', 'C-PERSONAL-OPEN'],
  },
  {
    id: 'S-WORK',
    title: 'Work',
    profile: { default: true },
    customInfo: { iconType: { emoji: 128_188 } },
    containerIDs: ['unpinned', 'C-WORK-OPEN', 'pinned', 'C-WORK-PINNED'],
  },
  {
    id: 'S-SIDE',
    title: 'Side project',
    profile: { custom: { _0: { directoryBasename: 'Profile 1', machineID: 'M1' } } },
    newContainerIDs: [{ pinned: {} }, 'C-SIDE-PINNED', { unpinned: {} }, 'C-SIDE-OPEN'],
  },
]

export const SIDEBAR = {
  sidebarSyncState: { container: { version: 1 } },
  version: 1,
  sidebar: {
    containers: [
      { global: {} },
      {
        spaces: spaces.flatMap((one) => [one.id, one]),
        items: items.flatMap((one) => [one.id, one]),
        topAppsContainerIDs: [
          { default: true },
          FAVORITES,
          { custom: { _0: { directoryBasename: 'Profile 1', machineID: 'M1' } } },
          OTHER_FAVORITES,
        ],
      },
    ],
  },
}

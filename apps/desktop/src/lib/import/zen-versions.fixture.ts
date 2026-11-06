const HOME = '{d12f5e21-86dc-4ab6-aa68-5179e3c6578d}'
const WORK = '{90bb2d5f-4e6e-4d01-80cf-84d545dda229}'
const DOCS = '1793911194239-60'

function tab(
  id: string,
  url: string,
  title: string,
  said: Record<string, unknown> = {},
): Record<string, unknown> {
  const pinned = said.pinned === true
  return {
    entries: [
      {
        url,
        title,
        cacheKey: 0,
        ID: 12,
        docshellUUID: '{42cd3f5f-14c5-45cf-9d9e-922bdc462183}',
        resultPrincipalURI: null,
        hasUserInteraction: false,
        docIdentifier: 14,
      },
    ],
    lastAccessed: 1793911190639,
    pinned: false,
    hidden: false,
    zenWorkspace: null,
    zenSyncId: id,
    zenEssential: false,
    zenDefaultUserContextId: null,
    zenPinnedIcon: null,
    zenIsEmpty: false,
    zenHasStaticIcon: false,
    zenGlanceId: null,
    zenIsGlance: false,
    ...(pinned ? { _zenPinnedInitialState: { entry: { url, title }, image: null } } : {}),
    _zenIsActiveTab: true,
    zenLiveFolderItemId: null,
    searchMode: null,
    userContextId: 0,
    attributes: {},
    index: 1,
    requestedIndex: 0,
    image: null,
    ...said,
  }
}

const essential = { pinned: true, zenEssential: true, zenDefaultUserContextId: 'true' }

export const ZEN_1_24 = {
  lastCollected: 1793911199000,
  tabs: [
    tab('1793911190671-29', 'https://example.com/mail', 'Mail', essential),
    tab('1793911191046-be', 'https://example.org/calendar', 'Calendar', essential),
    tab('1793911193323-9f', 'https://example.org/chat', 'Chat', essential),
    {
      ...tab('1793911194340-89', 'about:blank', '', { pinned: true, zenWorkspace: WORK }),
      entries: [{ url: 'about:blank', triggeringPrincipal_base64: '{"3":{}}' }],
      groupId: DOCS,
      zenIsEmpty: true,
      _zenPinnedInitialState: { entry: { url: 'about:blank' }, image: null },
      image: '',
      userTypedValue: '',
      userTypedClear: 0,
    },
    tab('1793911193747-51', 'https://example.com/docs/guide', 'Guide', {
      pinned: true,
      zenWorkspace: WORK,
      groupId: DOCS,
    }),
    tab('1793911193747-0c', 'https://example.com/docs/api', 'API', {
      pinned: true,
      zenWorkspace: WORK,
      groupId: DOCS,
    }),
    tab('1793911194340-a8', 'https://example.net/board', 'Board', {
      pinned: true,
      zenWorkspace: WORK,
    }),
    tab('1793911191392-53', 'https://example.net/news', 'News', {
      pinned: true,
      zenWorkspace: HOME,
    }),
    tab('1793911194671-92', 'https://example.org/search?q=b', 'b - Search', {
      zenWorkspace: WORK,
    }),
    tab('1793911191724-45', 'https://example.com/today', 'Today', { zenWorkspace: HOME }),
  ],
  folders: [
    {
      pinned: true,
      splitViewGroup: false,
      id: DOCS,
      name: 'Docs',
      collapsed: false,
      saveOnWindowClose: true,
      parentId: null,
      prevSiblingInfo: { type: 'start', id: null },
      emptyTabIds: ['1793911194340-89'],
      userIcon: '',
      workspaceId: WORK,
    },
  ],
  splitViewData: [],
  groups: [],
  spaces: [
    {
      uuid: HOME,
      icon: '🏡',
      name: 'Home',
      theme: { type: 'gradient', gradientColors: [], opacity: 0.5, texture: 0 },
      containerTabId: 0,
      hasCollapsedPinnedTabs: false,
    },
    {
      uuid: WORK,
      icon: 'chrome://browser/skin/zen-icons/selectable/briefcase.svg',
      name: 'Work',
      theme: { type: 'gradient', gradientColors: [], opacity: 0.5, texture: 0 },
      containerTabId: 0,
      hasCollapsedPinnedTabs: false,
    },
  ],
}

export const ZEN_TWILIGHT = {
  ...ZEN_1_24,
  tabs: ZEN_1_24.tabs.map((one) => ({
    ...one,
    zenEssential: one.zenEssential === true ? 'true' : null,
  })),
}

function oldTab(
  pin: string | null,
  url: string,
  title: string,
  said: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    entries: [{ url, title, cacheKey: 0, ID: 12, docIdentifier: 14 }],
    lastAccessed: 1793911475933,
    pinned: pin !== null,
    hidden: false,
    zenWorkspace: null,
    zenPinnedId: pin,
    zenEssential: null,
    zenDefaultUserContextId: null,
    zenPinnedEntry: null,
    zenPinnedIcon: null,
    zenIsEmpty: false,
    zenHasStaticLabel: false,
    zenGlanceId: null,
    zenIsGlance: false,
    searchMode: null,
    userContextId: 0,
    attributes: {},
    index: 1,
    requestedIndex: 0,
    image: 'data:,',
    ...said,
  }
}

const OLD_HOME = '{d88f2556-133e-46ba-ac88-679b67e17db0}'
const OLD_WORK = '{82cd46dd-7275-4832-8a1c-a0f01c885cc7}'
const OLD_DOCS = '{454e6094-0951-49df-b99b-8c428f295af9}'
const oldEssential = { zenEssential: 'true', zenDefaultUserContextId: 'true' }

export const ZEN_1_17 = {
  version: ['sessionrestore', 1],
  windows: [
    {
      tabs: [
        oldTab('{b4f39bc8}', 'https://example.com/mail', 'Mail', oldEssential),
        oldTab('{df93b211}', 'https://example.org/calendar', 'Calendar', oldEssential),
        oldTab('{9337aadc}', 'https://example.org/chat', 'Chat', oldEssential),
        oldTab(null, 'about:blank', '', {
          pinned: true,
          groupId: '1793911480716-60',
          zenIsEmpty: true,
        }),
        oldTab('{96ffe3c8}', 'https://example.com/docs/guide', 'Guide', {
          zenWorkspace: OLD_WORK,
          groupId: '1793911480716-60',
        }),
        oldTab('{96291a0c}', 'https://example.com/docs/api', 'API', {
          zenWorkspace: OLD_WORK,
          groupId: '1793911480716-60',
        }),
        oldTab('{519add78}', 'https://example.net/board', 'Board', { zenWorkspace: OLD_WORK }),
        oldTab(null, 'https://example.org/search?q=b', 'b - Search', { zenWorkspace: OLD_WORK }),
      ],
      groups: [],
      folders: [
        {
          pinned: true,
          splitViewGroup: false,
          id: '1793911480716-60',
          name: 'Docs',
          collapsed: false,
          saveOnWindowClose: true,
          parentId: null,
          prevSiblingInfo: null,
          emptyTabIds: [null],
          userIcon: '',
          pinId: OLD_DOCS,
          workspaceId: OLD_WORK,
        },
      ],
      splitViewData: [],
    },
  ],
  savedGroups: [],
}

function pin(
  id: number,
  uuid: string,
  title: string,
  url: string,
  workspace: string | null,
  position: number,
  said: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    uuid,
    title,
    url,
    container_id: null,
    workspace_uuid: workspace,
    position,
    is_essential: 0,
    is_group: 0,
    created_at: 1793911477427,
    updated_at: 1793911477427,
    edited_title: 0,
    is_folder_collapsed: 0,
    folder_icon: null,
    folder_parent_uuid: null,
    ...said,
  }
}

export const ZEN_1_17_PLACES = {
  bookmarks: null,
  spaces: [
    {
      id: 3,
      uuid: OLD_WORK,
      name: 'Work',
      icon: 'chrome://browser/skin/zen-icons/selectable/briefcase.svg',
      container_id: null,
      position: 2000,
      created_at: 1793911477908,
      updated_at: 1793911477908,
      theme_type: 'gradient',
      theme_colors: '[]',
      theme_opacity: 0.5,
      theme_rotation: null,
      theme_texture: null,
    },
    {
      id: 2,
      uuid: OLD_HOME,
      name: 'Home',
      icon: '🏡',
      container_id: null,
      position: 1000,
      created_at: 1793911465689,
      updated_at: 1793911475904,
      theme_type: 'gradient',
      theme_colors: '[]',
      theme_opacity: 0.5,
      theme_rotation: null,
      theme_texture: null,
    },
  ],
  pins: [
    pin(3, '{7e1e1fe8}', 'News', 'https://example.net/news', OLD_HOME, 2),
    pin(8, '{b4f39bc8}', 'example.com/mail', 'https://example.com/mail', null, 0, {
      is_essential: 1,
    }),
    pin(9, '{df93b211}', 'Example Domain', 'https://example.org/calendar', null, 1, {
      is_essential: 1,
    }),
    pin(10, '{9337aadc}', 'Example Domain', 'https://example.org/chat', null, 2, {
      is_essential: 1,
    }),
    pin(11, '{519add78}', 'example.net/board', 'about:blank', OLD_WORK, 6),
    pin(12, '{96ffe3c8}', 'The guide', 'https://example.com/docs/guide', OLD_WORK, 4, {
      edited_title: 1,
      folder_parent_uuid: OLD_DOCS,
    }),
    pin(13, '{96291a0c}', 'Example Domain', 'https://example.com/docs/api', OLD_WORK, 5, {
      folder_parent_uuid: OLD_DOCS,
    }),
    pin(14, OLD_DOCS, 'Docs', '', OLD_WORK, 3, { is_group: 1, edited_title: 1 }),
  ],
  assigned: [],
}

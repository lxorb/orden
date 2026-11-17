import { DEFAULT_PAGE_SETUP, ORIENTATIONS, PAPER_SIZES } from '@orden/contracts'
import { choices } from '../../modes/src/api'
import type { Pane } from './fields'

export function exportPane(): Pane {
  return {
    id: 'export',
    label: 'Export',
    groups: [
      {
        title: 'Page',
        fields: [
          {
            kind: 'select',
            key: 'export.paper',
            label: 'Paper',
            hint: 'The paper size of a PDF or a print.',
            options: PAPER_SIZES.map((size) => ({ value: size, label: size })),
            get: () => choices.page.paper,
            set: (value) => choices.setPage({ paper: value as never }),
          },
          {
            kind: 'select',
            key: 'export.orientation',
            label: 'Orientation',
            hint: 'Whether pages are upright or on their side.',
            options: ORIENTATIONS.map((one) => ({ value: one, label: one })),
            get: () => choices.page.orientation,
            set: (value) => choices.setPage({ orientation: value as never }),
          },
          {
            kind: 'text',
            key: 'export.margin',
            label: 'Margin',
            hint: 'The space around the edge of each page, such as 20mm or 1in.',
            placeholder: DEFAULT_PAGE_SETUP.margin,
            live: true,
            get: () => choices.page.margin,
            set: (value) => choices.setPage({ margin: value }),
          },
          {
            kind: 'text',
            key: 'export.header',
            label: 'Header',
            hint: 'Text at the top of every page; ${title}, ${date} and ${year} are filled in.',
            placeholder: '${title}',
            live: true,
            get: () => choices.page.header,
            set: (value) => choices.setPage({ header: value }),
          },
          {
            kind: 'text',
            key: 'export.footer',
            label: 'Footer',
            hint: 'Text at the bottom of every page; ${title}, ${date} and ${year} are filled in.',
            placeholder: '${date}',
            live: true,
            get: () => choices.page.footer,
            set: (value) => choices.setPage({ footer: value }),
          },
          {
            kind: 'select',
            key: 'export.appearance',
            label: 'Appearance',
            hint: 'Whether an export is light, dark, or as the app is now.',
            options: [
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'app', label: 'Match the app' },
            ],
            get: () => choices.exportAppearance,
            set: (value) => choices.setExportAppearance(value as never),
          },
        ],
      },
    ],
  }
}

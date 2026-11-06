export interface Script {
  code: string
  name: string
  sample: string
  draws: boolean
  languages: readonly string[]
}

export const SCRIPTS: readonly Script[] = [
  {
    code: 'Latn',
    name: 'Latin',
    sample: 'Settings',
    draws: true,
    languages: [
      'en',
      'de',
      'es',
      'fil',
      'fr',
      'gsw',
      'ha',
      'id',
      'it',
      'jv',
      'ms',
      'pl',
      'pt-BR',
      'pt-PT',
      'sw',
      'tr',
      'vi',
    ],
  },
  {
    code: 'Cyrl',
    name: 'Cyrillic',
    sample: 'Настройки',
    draws: true,
    languages: ['ru', 'uk'],
  },
  {
    code: 'Grek',
    name: 'Greek',
    sample: 'Ρυθμίσεις',
    draws: true,
    languages: [],
  },
  {
    code: 'Hans',
    name: 'Chinese, simplified',
    sample: '设置',
    draws: true,
    languages: ['zh-Hans'],
  },
  {
    code: 'Hant',
    name: 'Chinese, traditional',
    sample: '設定',
    draws: true,
    languages: ['yue', 'zh-Hant', 'zh-Hant-HK'],
  },
  {
    code: 'Jpan',
    name: 'Japanese',
    sample: '設定する',
    draws: true,
    languages: ['ja'],
  },
  {
    code: 'Kore',
    name: 'Korean',
    sample: '설정',
    draws: true,
    languages: ['ko'],
  },

  {
    code: 'Deva',
    name: 'Devanagari',
    sample: 'सेटिंग',
    draws: false,
    languages: ['hi', 'mr'],
  },
  {
    code: 'Beng',
    name: 'Bengali',
    sample: 'সেটিংস',
    draws: false,
    languages: ['bn'],
  },
  {
    code: 'Guru',
    name: 'Gurmukhi',
    sample: 'ਸੈਟਿੰਗਾਂ',
    draws: false,
    languages: ['pa'],
  },
  {
    code: 'Gujr',
    name: 'Gujarati',
    sample: 'સેટિંગ્સ',
    draws: false,
    languages: ['gu'],
  },
  {
    code: 'Taml',
    name: 'Tamil',
    sample: 'அமைப்புகள்',
    draws: false,
    languages: ['ta'],
  },
  {
    code: 'Telu',
    name: 'Telugu',
    sample: 'సెట్టింగ్‌లు',
    draws: false,
    languages: ['te'],
  },
  {
    code: 'Knda',
    name: 'Kannada',
    sample: 'ಸೆಟ್ಟಿಂಗ್‌ಗಳು',
    draws: false,
    languages: ['kn'],
  },
  {
    code: 'Mlym',
    name: 'Malayalam',
    sample: 'ക്രമീകരണങ്ങൾ',
    draws: false,
    languages: ['ml'],
  },
  {
    code: 'Arab',
    name: 'Arabic',
    sample: 'الإعدادات',
    draws: false,
    languages: ['ar', 'fa', 'ps', 'ur'],
  },
  {
    code: 'Thai',
    name: 'Thai',
    sample: 'การตั้งค่า',
    draws: false,
    languages: ['th'],
  },
  {
    code: 'Mymr',
    name: 'Burmese',
    sample: 'ဆက်တင်များ',
    draws: false,
    languages: ['my'],
  },
  {
    code: 'Ethi',
    name: 'Ethiopic',
    sample: 'ቅንብሮች',
    draws: false,
    languages: ['am'],
  },
]

export function drawsScript(code: string | undefined): boolean {
  if (!code) return true

  return SCRIPTS.find((one) => one.code === code)?.draws ?? true
}

export function scriptsNotDrawn(): readonly Script[] {
  return SCRIPTS.filter((one) => !one.draws)
}

/** What the brands are called and looked for by, where Simple Icons' slug does not say
 *  it (#1082).
 *
 *  The set ships each logo under a slug and nothing else: `visualstudiocode`, `obsstudio`,
 *  `openai`. A slug is a name squashed into one word, which a search for "obs" still
 *  finds and a search for "vs code" or "chatgpt" does not, and which a tooltip reads out
 *  as one long word. So the brands people reach for most get their own name here, and
 *  the other words they go by. Every other logo keeps its slug, which is all the set
 *  gives it. Loaded with the set, so none of this is in front of the first paint. */

/** Slug to the brand's name as it writes it. */
export const CALLED: Readonly<Record<string, string>> = {
  anthropic: 'Anthropic',
  claude: 'Claude',
  openai: 'OpenAI',
  googlegemini: 'Google Gemini',
  githubcopilot: 'GitHub Copilot',
  huggingface: 'Hugging Face',
  mistralai: 'Mistral AI',
  visualstudiocode: 'Visual Studio Code',
  visualstudio: 'Visual Studio',
  obsstudio: 'OBS Studio',
  github: 'GitHub',
  gitlab: 'GitLab',
  linkedin: 'LinkedIn',
  youtube: 'YouTube',
  googlechrome: 'Google Chrome',
  googledrive: 'Google Drive',
  googledocs: 'Google Docs',
  googlesheets: 'Google Sheets',
  googlecalendar: 'Google Calendar',
  googlemaps: 'Google Maps',
  microsoftteams: 'Microsoft Teams',
  whatsapp: 'WhatsApp',
  tiktok: 'TikTok',
  stackoverflow: 'Stack Overflow',
  epicgames: 'Epic Games',
  playstation: 'PlayStation',
  icloud: 'iCloud',
  paypal: 'PayPal',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  nodedotjs: 'Node.js',
  latex: 'LaTeX',
}

/** Slug to the other words a brand is looked for by: its product's name where the logo
 *  is the company's, and what people call it. */
export const ALSO: Readonly<Record<string, string>> = {
  anthropic: 'claude ai',
  claude: 'claude code anthropic ai',
  openai: 'chatgpt gpt codex ai',
  googlegemini: 'gemini ai',
  githubcopilot: 'copilot ai',
  perplexity: 'ai',
  deepseek: 'ai',
  ollama: 'ai llm',
  visualstudiocode: 'vs code vscode editor',
  obsstudio: 'obs recording streaming',
  blender: '3d',
  x: 'twitter',
  youtube: 'video',
  googlechrome: 'chrome browser',
  firefox: 'browser',
  discord: 'chat',
  slack: 'chat',
  whatsapp: 'chat',
  telegram: 'chat',
  spotify: 'music',
  figma: 'design',
  notion: 'notes',
  obsidian: 'notes',
}

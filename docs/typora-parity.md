# Typora parity checklist

Every feature Typora ships, tracked to done. Sourced from Typora's own docs
(Markdown Reference, How-Tos index, Shortcut Keys, Export, File Management,
Draw Diagrams, release notes through 1.14).

Legend: `[x]` done · `[~]` partial · `[ ]` todo · `[-]` deliberately skipped

## 1. Block elements

- [x] Paragraphs (blank-line separated)
- [x] Line break with `Shift+Enter`
- [x] Line break via two trailing spaces
- [x] Line break via `<br/>`
- [x] Headings `#` … `######`
- [x] Setext headings (`===`, `---` underlines)
- [x] Blockquotes `>`, arbitrarily nested
- [x] Unordered lists (`*`, `+`, `-`)
- [x] Ordered lists (`1.`), custom start numbers
- [x] Nested lists, indent/outdent with `Tab` / `Shift+Tab`
- [x] Loose vs tight list rendering
- [x] Task lists `- [ ]` / `- [x]`, clickable checkboxes
- [x] Fenced code blocks with language identifier
- [x] Indented code blocks
- [x] Math blocks `$$`
- [x] Tables with alignment (`:---`, `:---:`, `---:`)
- [x] Footnote definitions `[^id]:`
- [x] Horizontal rules (`***`, `---`, `___`)
- [x] YAML front matter
- [x] Table of contents `[toc]`
- [x] GitHub-style alerts / callouts (`> [!NOTE]` …)
- [x] Page breaks for export
- [x] Definition lists (Pandoc)
- [x] Abbreviations (Pandoc)

## 2. Span elements

- [x] Inline links `[text](url "title")`
- [x] Reference links `[text][id]` + `[id]: url`
- [x] Shortcut reference links `[text][]`
- [x] Internal heading links `[text](#heading)`
- [x] Autolinks `<url>` and bare `www.` / `http(s)://`
- [x] Images `![alt](path "title")`
- [x] Emphasis `*` / `_`
- [x] Strong `**` / `__`
- [x] Combined strong + emphasis
- [x] Inline code with backtick runs
- [x] Strikethrough `~~`
- [x] Escaping with `\`
- [x] Emoji shortcodes `:smile:`
- [x] Inline math `$…$`
- [x] Subscript `H~2~O`
- [x] Superscript `X^2^`
- [x] Highlight `==text==`
- [x] Underline via `<u>`
- [x] Smart punctuation (curly quotes, en/em dashes, ellipsis)
- [x] Ligatures: `->`, `<=`, `!=` and the like shown as arrows and signs, in prose and code, text untouched (off by default; the choice follows the account)

## 3. HTML support

- [x] Inline HTML spans with styles
- [x] Block-level HTML passthrough
- [x] `<iframe>` embeds
- [x] `<video>` / `<audio>` embeds with relative paths
- [x] HTML escaping in image attributes (XSS-safe)
- [x] HTML preserved through export
- [x] HTML escaped when publishing (blogs share a domain)

## 4. Math and academic

- [x] KaTeX rendering, inline and block
- [x] Auto-numbering for headings (CSS counters, toggleable)
- [x] Footnote rendering + back-links
- [x] Auto-numbering for equations
- [x] Cross references to numbered equations (`\label` / `\eqref`)
- [x] Chemical equations (mhchem)

## 5. Diagrams

- [x] ` ```mermaid ` - every Mermaid type, lazily loaded
- [x] ` ```flow ` (flowchart.js legacy)
- [x] ` ```sequence ` (js-sequence legacy syntax, drawn by Mermaid)
- [x] Diagram export in HTML/PDF
- [x] Mermaid syntax highlighting inside the fence

## 6. Code fences

- [x] Syntax highlighting for ~150 languages
- [x] Auto-pair brackets and quotes
- [x] Tab/indent behaviour inside fences
- [x] Language selector on the fence
- [x] Line numbers (toggle)
- [x] Copy button
- [x] Code block themes independent of app theme

## 7. Tables

- [x] Insert via `Ctrl+T`
- [x] Editable cells, written straight back as pipe-aligned markdown
- [x] Reorder rows and columns
- [x] Insert/delete row and column
- [x] Per-column alignment controls
- [x] Keyboard navigation (`Tab`, `Enter`)
- [x] Columns sized to content, CJK-aware
- [x] Resize columns by dragging
- [x] Paste TSV/CSV as a table

## 8. Images

- [x] Drag-and-drop insertion
- [x] Paste from clipboard, persisted to an `assets/` folder
- [x] Relative and absolute paths
- [x] Rendered inline in the editor
- [x] `typora-root-url` front matter
- [x] Resize handles, written back as `style="zoom:N%"`
- [x] Zoom / preview on click
- [-] Custom image uploader integration - a hook for third-party upload CLIs
      (PicGo, uPic). Sync already carries images; a second upload path would be
      a second place for them to live.

## 9. File management

- [x] Open folder as a space
- [x] File tree panel
- [x] Articles (flat file list) panel
- [x] Outline panel
- [x] Create, rename, duplicate, delete files and folders
- [x] Reveal in Explorer / Finder
- [x] Copy file path
- [x] Tabs, `Ctrl+Tab` switching
- [x] Reopen last files on start
- [x] Drag to move
- [x] Sort by name, modified, created
- [x] Show hidden files toggle
- [x] Recent files, and pinning notes and folders
- [x] Undo move/rename/delete
- [x] Auto-save
- [x] Version history and recovery

## 10. Search

- [x] Find `Ctrl+F`, find next/previous
- [x] Replace `Ctrl+H`, replace all
- [x] Regex and case-sensitive toggles
- [x] Quick open / fuzzy finder `Ctrl+P`
- [x] Global search across the space `Ctrl+Shift+F`
- [x] `#tag` search, with the space's tags listed by use

## 11. Editing modes and view

- [x] Source code mode `Ctrl+/`
- [x] Focus mode `F8`
- [x] Typewriter mode `F9`
- [x] Fullscreen `F11`
- [x] Zoom in/out/reset
- [x] Toggle sidebar `Ctrl+Shift+L`
- [x] Outline / Articles / File tree panels
- [x] Word count (words, characters, lines, reading time)
- [x] Custom context menus everywhere
- [x] Floating editor toolbar
- [x] Writing area width control
- [x] Line and paragraph spacing controls
- [x] RTL support

## 12. Editing behaviour

- [x] Auto-pair brackets, quotes, markdown symbols
- [x] Smart punctuation, toggleable
- [x] Select word `Ctrl+D`, select line `Ctrl+L`
- [x] Clear formatting `Ctrl+\`
- [x] Change list type via shortcut and context menu
- [x] Spellcheck (native, in the editor)
- [x] Every shortcut from Typora's table
- [x] Copy as Markdown / paste as plain text
- [x] Strict mode
- [x] Text snippets
- [x] Convert and reformat markdown

## 13. Themes and appearance

- [x] CSS theme files loaded from a themes folder
- [x] Theme switching without restart
- [x] Dark mode + light mode
- [x] Follows system appearance on first run
- [x] Four built-in themes
- [x] Typora CSS variable compatibility (`--bg-color`, `--md-char-color`, …)
- [x] `#write` container contract
- [x] Custom fonts (via a theme)
- [x] Custom CSS injection separate from themes
- [x] Code block themes

## 14. Export

- [x] PDF (through the print dialog)
- [x] HTML with styles, fully self-contained
- [x] HTML without styles
- [x] Word `.docx` (pandoc)
- [x] OpenOffice `.odt` (pandoc)
- [x] RTF (pandoc)
- [x] EPUB (pandoc)
- [x] LaTeX (pandoc)
- [x] MediaWiki (pandoc)
- [x] reStructuredText (pandoc)
- [x] Textile (pandoc)
- [x] OPML (pandoc)
- [x] RevealJS presentation (pandoc)
- [x] Print styles
- [x] Image export (local images inlined as `data:` URIs)
- [x] Export settings (paper size, orientation, margins, header/footer)
- [x] Per-file export config in YAML front matter (`export:`)

## 15. Import

- [x] Import via pandoc (docx, odt, rst, textile, epub, …)

## 16. System integration

- [x] Multiple windows
- [x] Open from shell / CLI with arguments
- [x] File association for `.md`
- [x] Taskbar Jump List - opened notes go to the shell's own recent documents
- [x] Application logs
- [x] UI translations (English, German; falls back to English)
- [x] "New Markdown" in Explorer's New menu - a per-user registry entry, added
      and removed from Appearance settings
- [~] Auto-update - checks GitHub daily and offers the release. Signed
      background install needs a Tauri updater keypair; the private half is a
      release secret, so generating it is the maintainer's call.

## 17. Beyond Typora

Features Typora does not have, which are the reason this exists.

- [x] Accounts, passwordless email sign-in
- [x] Spaces, each a folder of markdown
- [x] Cloud sync, offline-first, conflict-preserving
- [x] Publish a space as a blog, on a subdomain or your own domain
- [x] MCP server exposing notes to any LLM client
- [x] Command palette
- [x] Motion system across the whole interface
- [x] Recently deleted: notes and spaces wait 14 days before they are gone
- [x] Selecting several notes with Ctrl and Shift, moved or deleted together

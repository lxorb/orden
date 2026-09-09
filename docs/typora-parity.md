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
- [x] Task lists `- [ ]` / `- [x]`, clickable checkboxes, a menu row that makes
      one and `Ctrl+Enter` to tick the one under the caret
- [x] Fenced code blocks with language identifier
- [x] Indented code blocks
- [x] Math blocks `$$`
- [x] Tables with alignment (`:---`, `:---:`, `---:`)
- [x] Footnote definitions `[^id]:`
- [x] Horizontal rules (`***`, `---`, `___`)
- [x] YAML front matter, drawn as the rows it says; see section 17
- [x] Table of contents `[toc]`
- [x] Callouts: GitHub's alerts and Obsidian's syntax in one. Thirteen types and
      the other names for them (`tldr` and `summary` are `abstract`, `hint` is
      `tip`), each with its own icon and colour, a title of your own after the
      type, and a `-` or `+` after it saying whether it opens shut. A type
      nothing knows is still a callout, under its own name, so a theme can dress
      it with one rule and nothing has to be registered anywhere first
- [x] Comments, hidden in the editor, in the reading view, in every export, on a
      published page and on the glasses: a note to the writer stays one. Both
      spellings, the HTML one and Obsidian's `%%like this%%`, read by one scan
      that leaves code exactly as written
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
- [x] HTML escaped for a document that is not the reader's own: one in a space
      somebody else can reach, one being typed in by a peer in a room, anything
      a guest's session can see, and anything markup has been pasted into. The
      passthrough above is a feature of a local document, and this is where a
      document stops being local; the rule is `apps/desktop/src/lib/trust.ts`

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
- [x] ` ```chart ` - bar, line, pie and donut, drawn without a library, so a
      published page gets one too. See section 17

## 6. Code fences

- [x] Syntax highlighting for ~150 languages
- [x] Auto-pair brackets and quotes
- [x] Tab/indent behaviour inside fences
- [x] Language selector on the fence
- [x] Line numbers (toggle)
- [x] Copy button
- [x] Code block themes independent of app theme
- [x] What the block is, written after the language: ` ```ts src/main.ts `. The
      first word is the language and the rest is the caption, which is what every
      other markdown reader already ignores, so a note with captions in it opens
      unchanged anywhere else. `title="setup.js"`, which some editors write, is
      read as the same thing. It sits on the block's own top row, on the left,
      level with the language on the right, and steps aside while the caret is in
      the block and the fence's own line is showing. On a page and in an export it
      is a caption over the block

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
- [x] Sort by a column, from the button on it. Numbers sort as numbers and dates
      as dates, so 9 comes before 10 and a column of prices reads as money; blank
      cells go last whichever way the column runs, and rows that tie stay in the
      order they were written. It is an edit and not a way of looking: the rows
      really are reordered in the file, so the sort survives being read anywhere
      else
- [-] Merged cells - a pipe table has no way to say it, and writing an empty cell
      after a filled one would be a file that says something the table does not
      mean. Coloured header rows are a theme's business: `#write th` already
      carries a tint and a rule

## 8. Images

- [x] Drag-and-drop insertion
- [x] Paste from clipboard, persisted to an `assets/` folder
- [x] Relative and absolute paths
- [x] Rendered inline in the editor
- [x] `typora-root-url` front matter
- [x] Resize handles, written back as `style="zoom:N%"`
- [x] Zoom / preview on click
- [x] `![[shot.png]]` is a picture wherever it is written, and a bare file name
      is looked for anywhere in the space. Sound and film go the same way; see
      section 17
- [-] Custom image uploader integration - a hook for third-party upload CLIs
      (PicGo, uPic). Sync already carries images; a second upload path would be
      a second place for them to live.

## 9. File management

- [x] Open folder as a space
- [x] File tree panel
- [x] Articles (flat file list) panel
- [x] Outline panel, with the note's footnotes under its headings, and a heading
      draggable to move its whole section; see section 17
- [x] Create, rename, duplicate, delete files and folders
- [ ] Reveal in Explorer / Finder - not built, on purpose: nib is a notes app
      rather than a file manager, and the folder a note sits in is how the app
      finds it rather than something the reader is asked to hold. What still
      reaches the file manager is an export the reader just made, which is
      revealed where they put it
- [ ] Copy file path - the same, for the same reason
- [x] Tabs, `Ctrl+Tab` switching
- [x] Reopen last files on start
- [x] Drag to move
- [x] Sort by name, modified, created
- [x] Show hidden files toggle
- [x] Recent files, and pinning notes and folders
- [x] Undo move/rename/delete
- [x] Auto-save, for a note in a space, where it is not an option but the way the
      note works. A file opened from the computer is saved when asked.
- [x] A file opened from outside every space is watched: it reloads quietly when
      another program writes it, and keeps what is in the editor when there is
      something unsaved to lose
- [x] The line endings a file already had are the ones it is written back with
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
- [x] Word count (words, characters, lines, reading time), and with something
      selected the words and the characters read as `3/47w` - this many of that
      many. No word for it and nothing to turn on: the second number is what the
      bar said a moment ago. Every cursor's range counts, not only the first
- [x] Custom context menus everywhere
- [x] Floating editor toolbar
- [x] Writing area width control
- [x] Line and paragraph spacing controls
- [x] RTL support

## 12. Editing behaviour

- [x] Auto-pair brackets, quotes, markdown symbols
- [x] Smart punctuation, toggleable
- [x] Select the word `Ctrl+D`, select the line `Ctrl+L`. A second `Ctrl+D` takes
      the next one like it, which is where the extra cursors come from
- [x] Clear formatting `Ctrl+\`
- [x] Change list type via shortcut and context menu
- [x] Spellcheck (native, in the editor), on out of the box, with one switch to
      turn it off and the dictionary the machine is set to
- [x] A dictionary of your own. See section 17: it is not the system's
- [x] Every shortcut from Typora's table
- [x] A row in Paragraph for each of the blocks that had none: a task list, a
      callout, a footnote, a table of contents, front matter and a picture
- [x] Copy as Markdown / paste as plain text, and a plain copy that carries the
      note as HTML as well, so a paste into Word or mail keeps its formatting
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
- [x] More contrast, as a switch beside the mode rather than a theme of its own.
      A reader who needs the page easier to see should not have to give up the
      theme they chose, so this restates the palette over whichever theme is in
      force, on either side of it: text at 21:1, the muted words and the hairlines
      far enough up to be read and seen, and the accent still the colour they
      picked, moved further from the page. The syntax in a fence follows, which is
      the one thing a theme file cannot reach. A system that has contrast turned
      up gets it without asking here, and the switch is theirs to turn off

## 14. Export

Nine formats, in one fixed order in the File menu, the palette and the shortcut
settings. None of them needs anything installed.

- [x] Plain text (headings as lines, aligned columns, links as `words (url)`)
- [x] Markdown, as written, with wikilinks turned into relative links
- [x] TextBundle (version 2), and `.textpack` where a folder cannot be handed over
- [x] RTF 1.5, with tables, footnotes, links and embedded pictures
- [x] PDF (the webview's print engine on a desktop, the print dialog elsewhere)
- [x] JPG and PNG, the whole note at two device pixels
- [x] HTML with styles, fully self-contained, and HTML without styles
- [x] Word `.docx`, with real styles, numbering, footnotes and maths as OMML
- [x] EPUB 3 (epubcheck: no errors, no warnings)
- [x] Print styles, and a page break before a second top-level heading
- [x] Print, through the platform's own dialog, off the same page an export writes
- [x] Pictures carried into every format, off the disk and off the network
- [x] Export settings (paper size, orientation, margins, header/footer)
- [x] Per-file export config in YAML front matter (`export:`)
- [x] A remembered target folder, and the finished file revealed

Still pandoc's, and offered only where pandoc is installed:

- [x] OpenOffice `.odt`
- [x] LaTeX
- [x] MediaWiki
- [x] reStructuredText
- [x] Textile
- [x] OPML
- [x] RevealJS presentation

## 15. Import

- [x] Import via pandoc (docx, odt, rst, textile, epub, …), from the File menu

## 16. System integration

- [x] Multiple windows, and a window that stays over every other application
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
- [x] Folding: a chevron in the margin beside anything that folds, `Ctrl+Alt+[`
      for whatever the caret is in, `Ctrl+Alt+]` to open all of it, and a row in
      View for folding the note down to its headings. Headings, list items with
      children, indented blocks, fences and callouts all fold, and the caret is
      never folded out of sight: it comes up to the line that owns the fold.
      What is folded is remembered per note per device and never written into
      the note, with one exception that is not ours. Obsidian's `-` after a
      callout's type says that callout opens shut, so nib reads it, folds it on
      the way in and never rewrites it. Every chevron stands in one column beside
      the writing, never on the block it folds: a fence, a callout and a heading
      all inset their own text by different amounts, and the mark backs out by
      exactly that much. Folding moves rather than blinks - the lines shrink and
      fade together, the fold lands when they have gone and the mark that is left
      fades in, and opening runs it backwards - so nothing under the block jumps.
      Reduced motion makes all of it instant
- [x] A mark in the margin beside every block. Take hold of it to move the block,
      where a heading's block is its whole section, the way folding and the
      outline already mean it; the line it would land on is drawn as it is
      dragged, and the blank lines that make two paragraphs two paragraphs travel
      with it, so a list stays a list. Press it instead and it opens the menu a
      right press already opens, with three rows about the block at the top:
      duplicate it, delete it, and copy a link to it. Above them, quietly, what
      the block is and how many words are in it. Everything there acts on every
      block a selection covers, because a selection is a selection of text and
      never a mode. Only where there is a pointer: a finger has no hover and the
      margin is a thumb wide, so a long press opens the same menu
- [x] A link to a block: `[[Note#^a1b2c3]]`, with the name written at the end of
      the block where Obsidian writes it and shown nowhere. A heading is linked by
      its own words instead - `[[Note#The plan]]` - which needs no name and
      changes nothing in the note. Wherever one of these lands, the block it
      landed on holds a tint for long enough to find and then lets go of it: a
      caret is one pixel wide and the eye was somewhere else. The same mark for a
      bookmarked heading and a search result, and it goes at the first thing you
      do. A whole block, except a heading, whose block is its section - tinting a
      chapter to say "this heading" would be shouting
- [x] A bookmark of one block, from the mark in its margin. It points the way a
      link does, so a heading is kept by its words and anything else is given the
      same `^name` a link would give it, and the row is the block's own first
      words, because `^a1b2c3` is not something to read in a list. Opening it
      lands on the block with the tint above
- [x] A tab can be pinned. It sits at the head of its strip wearing only its
      mark - the icon the note chose, where it chose one - refuses the cross,
      `Ctrl+W` and the menu row until it is let go of again, and is never the tab
      a click in the file list takes over. What somebody keeps open all day, kept
      open: the daily note, the one being written towards. Pinning keeps the note
      as well, since a tab nobody wants taken over is a tab that is being kept,
      and a pin survives a restart. There is no default key for it, because the
      tab it is done to is already in front of you
- [x] Back and forward, per tab. A tab that moves on from one note to another
      leaves a trail, and `Alt+Left` and `Alt+Right` walk back along it and on
      again - the keys every browser uses, and the mouse's own two side buttons
      as well. Two arrows appear at the head of a strip that has been anywhere,
      each saying whether it can go, and the whole trail is behind a right press
      on the back one, newest first, to jump straight to any of it. Turning off
      halfway drops what was ahead, the way it does in anything that goes back
      and forward. On a Mac it is `Ctrl+[` and `Ctrl+]`: Alt and an arrow there is
      a word at a time and has been for forty years, and Cmd and a bracket is
      indenting here. Where a trail lands is where that note was left, through the
      places the app already keeps per note, and a trail lasts the sitting
- [x] Stacking tabs as columns to scroll sideways through is deliberately not
      built. What it is for is the trail, which is the entry above and which works
      in one pane, in a split, and on a phone - where columns of tabs cannot exist
      at all, since a handheld holds one document. Two notes side by side is
      already a split, up to four with linked scrolling; a third arrangement of
      the same tabs would need a second answer to every question the first two
      have settled
- [x] The outline and the links panel can be held on one note while another is
      written in the pane beside it: an outline to read down on the left, the note
      it is about on the right. One press in the panel's own row holds it and
      lets it go, the note it is held on is named quietly over it, and pressing a
      row takes you to that note wherever it is open. It lasts the sitting - a
      panel held on a note nobody remembers holding it on is worse than one that
      simply follows - and it is not offered on a handheld, which has one document
      and so nothing to hold a panel against
- [x] Bookmarks in groups. A group is a name with a twist in front of it, holding
      whatever is dragged onto it, nested as deep as it is useful, and it opens
      and shuts on this machine while the group itself travels with the account.
      Dropping a row between two rows of a group joins the group, which is what
      the line drawn there says. Removing a group dissolves it: what was in it
      comes up to where the group was, because the bookmarks were the point and
      the group was the shelf
- [x] Several cursors. Alt and a click puts another one down, Alt and a drag adds
      a whole range to what is already selected, Alt+Shift and a drag takes a
      column of them, and Escape leaves one. `Ctrl+D` grows to the word and then
      to the next one like it; adding a cursor straight above or below is
      `Ctrl+Alt+Shift+Up` and `Ctrl+Alt+Shift+Down`, because the chord every
      other editor uses for it splits the pane here. Selecting every one like
      what is selected has no key free and is in the palette. Each cursor reveals
      the syntax it is standing in, and each selection draws its own block
- [x] A `/` at the start of a line or after a space opens the blocks a note is
      written out of, filtered as you type. Enter inserts one and takes the slash
      with it, Escape leaves it alone, and a slash that names nothing stays a
      slash, so `and/or` and `24/7` are words. The rows are the ones the
      Paragraph menu and the palette show, out of one list, in the popup that
      `[[` and `:emoji:` already open
- [x] `aliases` in a note's front matter, whichever of the three ways YAML writes
      a list. `[[Roadmap]]` finds the note that declared it, the completion
      offers an alias under the note's own name, and backlinks and unlinked
      mentions count it. A file really called that always wins, so a note can
      never shadow a real one. A rename rewrites the links that spelled out the
      filename and never an alias: that is a name the writer chose, not a path
- [x] Files a note embeds, in Obsidian's spelling, so the note travels. A
      recording (`![[take.mp3]]`) and a film (`![[demo.mp4]]`) are the browser's
      own player, plainly, with no frame around them and nothing playing until
      somebody presses play. A paper (`![[paper.pdf#page=3]]`) and a plane
      (`![[Board.canvas]]`) are a card saying which file it is, which opens it at
      the page the link named. `![[shot.png|300]]` or `|300x200]]` is how wide to
      draw it, and anything else after the bar says what it is. The same four in
      the editor, in the reading view, in an export and on a published page; on
      the glasses each is one line, its name behind the picture mark
- [x] A page from somewhere else, written as a picture:
      `![](https://youtube.com/watch?v=…)`. Nine places are known - YouTube,
      Vimeo, X, Spotify, SoundCloud, Figma, CodePen, Loom and Google Maps - and
      everything else stays the link it was. Nothing is loaded from any of them
      until the reader asks: what the note renders as is a card the size the
      frame will be, saying whose page it stands for, and a click swaps in a
      sandboxed frame with only the permissions that provider needs. The card is
      a real link, which is what makes one piece of markup right everywhere: a
      published page runs no script of any kind, so there the same click simply
      takes the reader to the page. YouTube is framed from `youtube-nocookie.com`,
      and a frame tells the provider which site asked and never which note
- [x] ` ```chart ` fences, in the shape the Obsidian Charts plugin reads
      (`type`, `title`, `labels`, and `series` with a `title` and `data` each),
      drawn as `bar`, `line`, `pie` or `donut`. Built as an SVG out of the
      numbers with no charting library at all, which is what lets a published
      page draw one; the colours are the theme's, and the scale rounds to numbers
      somebody would have chosen. Chart.js's other hundred options are not read:
      a bar chart always starts at zero and a chart is always the width of the
      column. A fence holding no chart stays code, and on the glasses a titled
      chart is its title
- [x] A note's front matter drawn as the rows it says: the key on the left, the
      value in the control its shape asks for - a list as chips, a `true` as a
      checkbox, a date as a date - and nib's own `export:` page setup as its
      pairs. A block like every other block, so the caret going into it shows the
      YAML, and a click on a row puts the caret on that row's own line. That is
      why there is no setting for rows or source: the source is the editor, and a
      second way of editing metadata would be a second thing to keep in step with
      the file. `Add a property` at the foot writes a new key and leaves the caret
      on it. One rule for everything else: if any line of the block is a shape nib
      cannot read - a Dataview query, a comment - the **whole** block stays
      source, because half a table is a table that lies about the file. The rows
      show in the reading view too, and nowhere outside the app: front matter is
      about the note rather than part of it, and every export already leaves it out
- [x] A dictionary of your own. The menu over a word offers to add it, and from
      then on the wavy line under it is gone, wherever it appears, on every
      device: the list follows the account. Settings has it under Spelling, to
      read and to take words back from.

      What it is not, said plainly: nib does not spell-check - the webview does,
      and no browser on any platform lets a page ask which words its checker
      thinks are wrong, read its suggestions, or add one to a dictionary. So what
      this does is turn the checker off over the words you have added, which is
      the whole of what adding a word is for, and nothing more. The word is not
      learned by the system, so another app still underlines it, and nib cannot
      offer a correction for a word that really is misspelled
- [x] Dragging a heading in the Outline moves its whole section: the heading and
      everything under it, to where it was dropped. Two edits and never a
      rewrite, so a note open in a second pane keeps every caret outside the words
      that moved, and it is one thing to undo; a caret inside the section travels
      with it. Nothing is re-levelled - a `###` dragged above a `#` is still a
      `###`, because a drag is a move and rewriting the hashes answers a question
      nobody asked. The one move refused is a section dropped inside itself. On a
      touch screen a held finger opens the menu before a drag could start and a
      browser fires no drag events from a touch anyway, so there it is a `Move`
      row that asks where, the way moving a file is
- [x] The note's footnotes under its headings in the Outline: what each one says,
      with its label, and a click that goes to the mark in the words rather than
      to the definition at the bottom. In the order the words reach them, with the
      ones nothing points at after and drawn quiet - worth seeing precisely
      because nothing points at them
- [x] Recently deleted: notes and spaces wait 14 days before they are gone
- [x] Selecting several notes with Ctrl and Shift, moved or deleted together
- [x] Running a JavaScript fence from the note (`Ctrl+Enter`, or the play button
      on the block), with console output, the value of the last expression and
      errors in a panel under it. The code runs in a sandboxed iframe with an
      opaque origin and a `default-src 'none'` policy, so it reaches neither the
      app nor the network, and a run is stopped after ten seconds. Nothing of it
      is written to the note, saved or exported.

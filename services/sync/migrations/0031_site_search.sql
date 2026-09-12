-- The words of the published pages, so a site can be searched on the site.
--
-- A search box that reads every note out of storage would read a thousand
-- objects to answer one keystroke, so the words are indexed where they can be
-- asked about: SQLite's own full-text index, which D1 carries. One row per note,
-- written from the same place the note's front matter is read - one parse of
-- something already in hand - and asked at most once per search.
--
-- `note_id` and `space_id` are unindexed: they are what a hit is joined back on,
-- not something anybody searches for. The tokenizer folds diacritics, so a
-- reader who types `cafe` finds `café`, which is what every other search in nib
-- already does.
--
-- What is deliberately not here: the whole note. The first sixteen kilobytes of
-- its words, which is a long essay, because an index is for finding a page and
-- the page itself is one request away. See services/sync/src/blog/words.ts.
create virtual table note_search using fts5(
  note_id unindexed,
  space_id unindexed,
  path,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

-- What a note says about its own page now carries three things it did not: the
-- links out of it, so a page can say what links to it; its `order`, for a
-- navigation that is not alphabetical; and its tags. Every row is read again to
-- pick those up - the sweep that fills the column in is already bounded and
-- already runs nightly, and a null is how it knows there is reading to do. See
-- services/sync/src/blog/fill.ts.
update notes set front = null;

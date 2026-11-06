create virtual table note_search using fts5(
  note_id unindexed,
  space_id unindexed,
  path,
  title,
  body,
  tokenize = 'unicode61 remove_diacritics 2'
);

update notes set front = null;

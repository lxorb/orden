-- Which reading of a note's head wrote its `front`, and its words into `note_search`.
--
-- Until #453 neither took the writer's comments (`%%…%%`, `<!-- … -->`) out first, so a
-- summary, a heading, a tag or a link written inside one reached a published page's
-- description, its feeds and its search. The Worker now reads past them and writes
-- `front_rev = 1` beside what it read; a row at 0 was read the old way, or by an older
-- Worker, and the nightly sweep reads it again (src/blog/fill.ts). An older Worker never
-- reads the column and leaves it at what it was, so a note it writes is read again too.
alter table notes add column front_rev integer not null default 0;

-- And the words already indexed with an Obsidian comment in them, which nothing else
-- would take out before the sweep reaches the note: a note missing from the index is
-- one a search does not find until then, which is the safe way round. An HTML comment
-- was already dropped with the other tags (`plainWords`) unless it held a `>`.
delete from note_search where body like '%\%\%%' escape '\' or body like '%<!--%';

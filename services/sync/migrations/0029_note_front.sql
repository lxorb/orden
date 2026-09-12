-- What a note says about its own page, and every path it has answered on.
--
-- A published page is the note, so what the note says about itself is what the
-- page says about itself: `publish` decides whether it is on the site at all,
-- `permalink` says where it sits, `aliases` are the other paths that should
-- find it, and `description`, `image` and `date` become the page's own tags.
-- Obsidian Publish's keys, so a vault moves between the two without being
-- rewritten.
--
-- Kept here rather than read out of the body, because the site has to decide
-- about a thousand notes to answer one request and the bodies are in R2. Filled
-- from the body every time a note is written, which is one parse of the head of
-- something already in hand; null for a note last written before this, until
-- the space it is in is published or the nightly sweep reaches it. See
-- services/sync/src/blog/front.ts.
alter table notes add column front text;

-- Which notes have not been read yet, for that sweep. Partial, so the index is
-- only as big as the work left to do and is empty once there is none.
create index notes_front_missing on notes(space_id) where front is null;

-- Every path a page has answered on, so that none of them ever 404s.
--
-- A page moves for three reasons: the note was renamed, its `permalink` was
-- changed, or an alias was taken away. In all three the old path is already in
-- somebody's history, somebody's feed reader and somebody else's link, and a
-- 404 is the one answer that helps nobody. So a path is remembered when it stops
-- being current, and redirects to wherever the note is now.
--
-- Keyed by the path rather than by the note: that is the question a request
-- asks. `note_id` is what it redirects to, and the row goes with the note.
create table blog_paths (
  space_id text not null references spaces(id) on delete cascade,
  slug text not null,
  note_id text not null references notes(id) on delete cascade,
  at integer not null,
  primary key (space_id, slug)
);

-- What a note's own rows are, for taking them away when it moves again.
create index blog_paths_note on blog_paths(note_id);

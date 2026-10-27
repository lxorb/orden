-- Which versions are kept as they are, whatever is saved next.
--
-- A save less than five minutes after the newest version is folded into it, so that
-- the last save of a session is a version rather than dropped (src/versions.ts). A
-- version somebody needs by name is never folded away: the words that lost a modal
-- answer in sync v2, and the words a rollback writes over.
alter table note_versions add column held integer not null default 0;

-- And which device sent a version, as the session proves it (src/sync2/device.ts),
-- for the fold to tell two devices apart: `by` is the name a device gives itself,
-- which is its kind, so every Mac in a shared space has the same one. Null where
-- nothing proved it, and a row with none is never folded into.
alter table note_versions add column device text;

-- The rows from just before this runs are the only ones a fold can reach on its first
-- saves, and a modal answer's words among them look like any other row. Held, all of
-- them: a few rows more than the five minute rule would keep, and none of those words
-- folded away.
update note_versions set held = 1 where at > unixepoch() * 1000 - 15 * 60 * 1000;

-- Which versions are kept as they are, whatever is saved next.
--
-- A save less than five minutes after the newest version is folded into it, so that
-- the last save of a session is a version rather than dropped (src/versions.ts). A
-- version somebody needs by name is never folded away: the words that lost a modal
-- answer in sync v2, and the words a rollback writes over.
alter table note_versions add column held integer not null default 0;

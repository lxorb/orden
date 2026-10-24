-- What strangers sent through a form in a note emptied for good, and the addresses it
-- answered on.
--
-- Both are keyed by the note and go with its row (0029, 0032), but purging a note from
-- Recently deleted keeps the row as the tombstone the change feed relies on, so nothing
-- cascaded: the answers stayed listed under the note, counted towards the space's
-- ceilings for their 180 days, and the old paths - the note's old titles - stayed for
-- ever. The purge now takes both (src/trash.ts); these are the ones it left. A purged
-- note is deleted with no `deleted_at` (0017).
delete from form_answers
 where note_id in (select id from notes where deleted = 1 and deleted_at is null);
delete from blog_paths
 where note_id in (select id from notes where deleted = 1 and deleted_at is null);

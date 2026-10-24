-- The reminders of notes emptied for good.
--
-- A reminder is kept beside its note (0044) with the words of its task, and nothing
-- took it away when the note's words went: purging a note from Recently deleted, or a
-- space with all of its notes, left the rows until a day after their minute, which for
-- a task due in 2099 is 2099. They were never sent, because sending asks for the live
-- note, but they kept the words. The purge now takes them (src/trash.ts); these are the
-- ones it left. A purged note is deleted with no `deleted_at`, and a note of a purged
-- space has no row at all; a note in Recently deleted keeps its reminders, because it
-- can come back.
delete from push_reminders
 where note_id not in (select id from notes where deleted = 0 or deleted_at is not null);

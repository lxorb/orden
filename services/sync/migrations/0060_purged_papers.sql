-- What a note or a space emptied for good still named.
--
-- Purging a note from Recently deleted kept its row as the tombstone the change feed
-- relies on, with its size and hash cleared and its paper (0056) left in place; purging
-- a space kept its marker row with the files it listed (0014). So a purged page note
-- still served its PDF to whoever reached the note, and both still counted as a use of
-- the bytes: a deleted account handed them to the owner, who then paid for a file of
-- something that had gone. The purge now clears both (src/trash.ts); these are the rows
-- purged before it did. A purged row is one that is deleted with no `deleted_at`: the
-- purge is what clears it (0017).
update notes set paper = null where deleted = 1 and deleted_at is null and paper is not null;
update spaces set files = '[]' where deleted = 1 and deleted_at is null and files != '[]';

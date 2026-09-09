-- Notes that were soft deleted before Recently deleted existed, and the index
-- the purge walks.
--
-- Until 0011 a deleted note was `deleted = 1` and nothing else. 0011 added
-- `deleted_at` and every delete since has stamped it, but the rows already
-- there kept a null - and a null is what the purge reads as "already emptied":
-- `deleted_at is not null` is in every query that looks for something to purge.
-- So those notes were rows nobody could see and bytes nobody would ever
-- collect. Stamped with `updated_at`, which is when the delete wrote the row
-- and so as close to when it happened as anything here knows. They are all far
-- older than the fourteen days Recently deleted holds, so the next nightly run
-- empties them, which is what should have happened at the time.
update notes set deleted_at = updated_at where deleted = 1 and deleted_at is null;

-- The purge asks for the oldest `deleted_at` across every note there is, and
-- the answer is a handful of rows in a table that grows with everything anybody
-- ever wrote. Partial, because a live note's null says nothing anyone asks
-- about: the index is the size of Recently deleted rather than of the store.
create index notes_deleted_at on notes(deleted_at) where deleted_at is not null;

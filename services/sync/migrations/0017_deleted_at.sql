update notes set deleted_at = updated_at where deleted = 1 and deleted_at is null;

create index notes_deleted_at on notes(deleted_at) where deleted_at is not null;

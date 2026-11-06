delete from push_reminders
 where note_id not in (select id from notes where deleted = 0 or deleted_at is not null);

delete from form_answers
 where note_id in (select id from notes where deleted = 1 and deleted_at is null);
delete from blog_paths
 where note_id in (select id from notes where deleted = 1 and deleted_at is null);

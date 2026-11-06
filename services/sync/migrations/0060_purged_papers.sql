update notes set paper = null where deleted = 1 and deleted_at is null and paper is not null;
update spaces set files = '[]' where deleted = 1 and deleted_at is null and files != '[]';

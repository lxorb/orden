create trigger chats_come_back after update of deleted on notes
  when old.deleted = 1 and new.deleted = 0
begin
  update chats set ended_at = null where file_id = new.id and ended_at is not null;
end;

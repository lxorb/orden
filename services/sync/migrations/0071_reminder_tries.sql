-- A reminder no service took is tried again (src/push/reminders.ts): how many times it
-- has been pushed, and when it may be again. Null for one not tried yet, which goes first.
alter table push_reminders add column tries integer not null default 0;
alter table push_reminders add column retry_at integer;

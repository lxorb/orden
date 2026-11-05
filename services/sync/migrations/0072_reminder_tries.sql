alter table push_reminders add column tries integer not null default 0;
alter table push_reminders add column retry_at integer;

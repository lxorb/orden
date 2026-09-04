-- The settings that follow the account rather than the machine, as one JSON
-- object: empty until something is chosen, and read by every device.
alter table users add column settings text not null default '{}';

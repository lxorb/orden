alter table note_versions add column held integer not null default 0;

alter table note_versions add column device text;

update note_versions set held = 1 where at > unixepoch() * 1000 - 15 * 60 * 1000;

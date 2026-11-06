create table note_versions (
  note_id text not null references notes(id) on delete cascade,
  at integer not null,
  hash text not null,
  size integer not null,
  by text not null default '',
  primary key (note_id, at)
);

create index note_versions_hash on note_versions(hash);

create index note_versions_at on note_versions(at);

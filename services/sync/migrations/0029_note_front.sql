alter table notes add column front text;

create index notes_front_missing on notes(space_id) where front is null;

create table blog_paths (
  space_id text not null references spaces(id) on delete cascade,
  slug text not null,
  note_id text not null references notes(id) on delete cascade,
  at integer not null,
  primary key (space_id, slug)
);

create index blog_paths_note on blog_paths(note_id);

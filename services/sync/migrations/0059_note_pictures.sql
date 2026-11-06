create table note_pictures (
  note_id text not null references notes(id) on delete cascade,
  hash text not null,
  primary key (note_id, hash)
);

create index note_pictures_hash on note_pictures(hash);

create index notes_file_hash on notes(hash) where kind = 'file';
create index notes_paper on notes(paper) where paper is not null;


create table form_answers (
  id text primary key,
  space_id text not null references spaces(id) on delete cascade,
  note_id text not null references notes(id) on delete cascade,
  at integer not null,
  answers text not null
);

create index form_answers_note on form_answers(note_id, at);

create index form_answers_space on form_answers(space_id, at);

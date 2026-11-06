alter table form_answers add column bytes integer not null default 0;

update form_answers set bytes = length(cast(answers as blob));

create index form_answers_space_bytes on form_answers(space_id, bytes);

create index form_answers_at on form_answers(at);

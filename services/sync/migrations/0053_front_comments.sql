alter table notes add column front_rev integer not null default 0;

delete from note_search where body like '%\%\%%' escape '\' or body like '%<!--%';

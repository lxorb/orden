create table folders (
  id         text    primary key,
  space_id   text    not null references spaces(id) on delete cascade,
  parent_id  text,
  name       text    not null,
  name_key   text    not null,
  seq        integer not null,
  deleted    integer not null default 0,
  deleted_at integer,
  deleted_in integer,
  updated_at integer not null,
  updated_by text
);
create unique index folders_live_name on folders(space_id, coalesce(parent_id, ''), name_key)
  where deleted = 0;
create index folders_space_seq on folders(space_id, seq);

alter table notes add column folder_id text;
alter table notes add column name text;
alter table notes add column name_key text;
alter table notes add column kind text not null default 'note';
alter table notes add column epoch integer not null default 0;
alter table notes add column epoch_base text;
alter table notes add column doc_seq integer;
alter table notes add column doc_by text;
alter table notes add column updated_by text;
alter table notes add column deleted_in integer;
create unique index notes_live_name on notes(space_id, coalesce(folder_id, ''), name_key)
  where deleted = 0 and name_key is not null;

create table tree_ops (
  op_id    text    primary key,
  space_id text    not null,
  result   text    not null,
  at       integer not null
);
create index tree_ops_at on tree_ops(at);

alter table users add column sync_version integer not null default 1;

alter table spaces add column prepared_at integer;

create table space_entries (
  space_id text    not null references spaces(id) on delete cascade,
  map      text    not null,
  key      text    not null,
  value    text,
  seq      integer not null,
  at       integer not null,
  by       text,
  primary key (space_id, map, key)
);
create index space_entries_seq on space_entries(space_id, seq);

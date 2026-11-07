create table pass_file_parts (
  item_id text not null,
  file_id text not null,
  part integer not null,
  parts integer not null,
  vault_id text not null,
  user_id text not null,
  size integer not null,
  at integer not null,
  primary key (item_id, file_id, part)
);

create index pass_file_parts_vault on pass_file_parts (vault_id, item_id);
create index pass_file_parts_user on pass_file_parts (user_id);

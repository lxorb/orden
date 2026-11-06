create table chats (
  id         text    primary key,
  space_id   text    not null references spaces(id) on delete cascade,
  file_id    text,
  created_at integer not null,
  last_seq   integer not null default 0,
  last_at    integer,
  last_by    text,
  topic      text    not null default '',
  posting    text    not null default 'writers' check (posting in ('writers', 'owner')),
  slowmode   integer not null default 0,
  ended_at   integer
);

create index chats_space on chats(space_id);
create unique index chats_file on chats(file_id) where file_id is not null;
create index chats_ended on chats(ended_at) where ended_at is not null;

create table chat_reads (
  chat_id     text    not null,
  who         text    not null,
  read_seq    integer not null default 0,
  mentions    integer not null default 0,
  notify      text    check (notify in ('all', 'mentions', 'nothing')),
  muted_until integer,
  primary key (chat_id, who)
);

create index chat_reads_who on chat_reads(who);

create table chat_files (
  chat_id text    not null,
  hash    text    not null,
  size    integer not null,
  type    text    not null,
  name    text    not null,
  at      integer not null,
  primary key (chat_id, hash)
);

create index chat_files_hash on chat_files(hash);

create table chat_sockets (
  chat_id   text    not null,
  space_id  text    not null,
  who       text    not null,
  opened_at integer not null,
  primary key (chat_id, who)
);

create index chat_sockets_space on chat_sockets(space_id, who);
create index chat_sockets_opened on chat_sockets(opened_at);

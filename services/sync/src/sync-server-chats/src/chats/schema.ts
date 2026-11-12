export const SCHEMA = `
create table if not exists events (
  seq integer primary key,
  id text not null unique,
  kind text not null,
  target text,
  message text,
  parent text,
  author text not null,
  device text,
  at integer not null,
  made_at integer,
  body text not null
);
create index if not exists events_target on events(target) where target is not null;
create index if not exists events_message on events(message) where message is not null;
create index if not exists events_parent on events(parent) where parent is not null;
create table if not exists messages (
  seq integer primary key,
  id text not null unique,
  author text not null,
  at integer not null,
  parent text,
  deleted integer not null default 0,
  replies integer not null default 0,
  body text not null,
  json text not null
);
create virtual table if not exists words using fts5(body, content='messages', content_rowid='seq');
create trigger if not exists messages_in after insert on messages begin
  insert into words(rowid, body) values (new.seq, new.body);
end;
create trigger if not exists messages_changed after update of body on messages begin
  insert into words(words, rowid, body) values ('delete', old.seq, old.body);
  insert into words(rowid, body) values (new.seq, new.body);
end;
create table if not exists meta (key text primary key, value text);
create table if not exists members (
  who text primary key,
  read_seq integer not null default 0,
  dirty integer not null default 0
);
create table if not exists mentioned (
  who text not null,
  seq integer not null,
  primary key (who, seq)
);
create table if not exists scheduled (
  id text primary key,
  message text not null,
  author text not null,
  device text,
  send_at integer not null,
  post text not null,
  refused text
);
create table if not exists scheduled_tries (
  id text primary key,
  tries integer not null,
  next_at integer not null
);
create table if not exists pokes (
  id text primary key,
  sent_at integer not null default 0,
  seq integer,
  at integer,
  by text,
  mention integer not null default 0
);
create table if not exists paces (
  who text not null,
  kind text not null,
  since integer not null,
  count integer not null,
  primary key (who, kind)
);
`

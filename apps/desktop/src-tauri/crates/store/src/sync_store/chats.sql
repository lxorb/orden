create table meta (key text primary key, value blob);

create table chats (id text primary key, space text not null,
                    seq integer not null default 0, read_seq integer not null default 0,
                    oldest integer, complete integer not null default 0, row text);

create table messages (chat text not null, id text not null, seq integer not null,
                       at integer not null, author text not null, parent text,
                       main integer not null, deleted integer not null, body text not null,
                       has text not null, upto integer not null, json text not null,
                       marks text, primary key (chat, id));
create index messages_main on messages (chat, main, seq);
create index messages_parent on messages (chat, parent, seq);
create index messages_at on messages (at);

create virtual table words using fts5(body, content = 'messages', content_rowid = 'rowid',
                                      tokenize = 'unicode61 remove_diacritics 2');

create trigger messages_made after insert on messages begin
  insert into words (rowid, body) values (new.rowid, new.body);
end;
create trigger messages_gone after delete on messages begin
  insert into words (words, rowid, body) values ('delete', old.rowid, old.body);
end;
create trigger messages_reworded after update of body on messages begin
  insert into words (words, rowid, body) values ('delete', old.rowid, old.body);
  insert into words (rowid, body) values (new.rowid, new.body);
end;

create table outbox (id text primary key, chat text not null, event text not null,
                     made_at integer not null, tries integer not null default 0,
                     refused text);
create index outbox_chat on outbox (chat, made_at);

create table drafts (chat text primary key, text text not null, at integer not null);

alter table users add column totp_secret text;

alter table users add column totp_at integer;

create table recovery_codes (
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  used_at integer,
  primary key (user_id, code_hash)
);

alter table sessions add column id text;
alter table sessions add column name text not null default '';
alter table sessions add column last_used_at integer;

update sessions set id = lower(hex(randomblob(8))) where id is null;

create index sessions_id on sessions(id);

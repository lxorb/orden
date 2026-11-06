alter table users add column openai_key text;

alter table users add column openai_key_tail text;

update users
   set settings = json_remove(settings, '$.glassesKey')
 where json_valid(settings) and json_extract(settings, '$.glassesKey') is not null;

create table cached (
  scope text    not null,
  key   text    not null,
  value text    not null,
  until integer not null,
  primary key (scope, key)
);

create index cached_until on cached(until);

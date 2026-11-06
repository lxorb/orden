create table feedback (
  id text primary key,
  user_id text,
  text text not null,
  version text not null default '',
  platform text not null default '',
  log text not null default '',
  created_at integer not null
);

create index feedback_by_time on feedback (created_at);

create table crash_reports (
  id text primary key,
  signature text not null,
  kind text not null,
  version text not null,
  platform text not null,
  created_at integer not null,
  body text
);

create index crash_reports_of on crash_reports (signature, created_at);
create index crash_reports_by_age on crash_reports (created_at);

create table crash_groups (
  signature text primary key,
  kind text not null,
  title text not null,
  first_at integer not null,
  last_at integer not null,
  count integer not null default 0,
  issue_number integer,
  issue_url text
);

create index crash_groups_latest on crash_groups (last_at);

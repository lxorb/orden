alter table feedback add column issue_number integer;
alter table feedback add column issue_url text;
alter table feedback add column issue_tries integer not null default 0;
alter table feedback add column issue_next_at integer not null default 0;
alter table feedback add column issue_claim integer;

create index feedback_waiting on feedback (issue_next_at) where issue_number is null;

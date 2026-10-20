-- The issue a report sent with Send feedback became (#666), in the private repository
-- `FEEDBACK_REPO` names: its number and its address, null until it is open. A report
-- whose issue could not be opened - GitHub out of reach, or no token set yet - keeps
-- both null and is tried again from the cron: `issue_tries` how often so far,
-- `issue_next_at` when next, and `issue_claim` when a run took it on, so two runs never
-- open two issues for one report.
alter table feedback add column issue_number integer;
alter table feedback add column issue_url text;
alter table feedback add column issue_tries integer not null default 0;
alter table feedback add column issue_next_at integer not null default 0;
alter table feedback add column issue_claim integer;

create index feedback_waiting on feedback (issue_next_at) where issue_number is null;

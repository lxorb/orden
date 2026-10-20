-- What somebody sent with Send feedback (#548): the words they wrote, and what the app
-- added - its version, the platform, the recent app log - and nothing of their notes.
--
-- `user_id` is the account that sent it, or null when nobody was signed in; deleting the
-- account deletes its reports (erase.ts). Kept until somebody deletes them by hand: a
-- report is read, answered and then cleared, and nothing here sweeps it.
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

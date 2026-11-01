-- A report's issue put on the project board `FEEDBACK_PROJECT` names, as Todo: the issue's
-- node id GitHub's GraphQL knows it by, and when it went on the board, null until it has.
-- One the board did not take - GitHub out of reach, or a token without the `project`
-- scope - is tried again from the cron: `board_tries` how often so far, `board_next_at`
-- when next.
alter table feedback add column issue_node text;
alter table feedback add column board_at integer;
alter table feedback add column board_tries integer not null default 0;
alter table feedback add column board_next_at integer not null default 0;

create index feedback_off_board on feedback (board_next_at)
  where issue_number is not null and board_at is null;

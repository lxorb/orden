alter table feedback add column issue_node text;
alter table feedback add column board_at integer;
alter table feedback add column board_tries integer not null default 0;
alter table feedback add column board_next_at integer not null default 0;

create index feedback_off_board on feedback (board_next_at)
  where issue_number is not null and board_at is null;

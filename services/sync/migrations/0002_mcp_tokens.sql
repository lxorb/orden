create table mcp_tokens (
  token_hash   text    primary key,
  user_id      text    not null references users(id) on delete cascade,
  read_only    integer not null default 1,
  created_at   integer not null,
  last_used_at integer
);

create index mcp_tokens_user on mcp_tokens(user_id);

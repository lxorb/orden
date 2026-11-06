create table once_shared (
  space_id text    not null references spaces(id) on delete cascade,
  item     text    not null default '',
  at       integer not null,
  primary key (space_id, item)
);

insert or ignore into once_shared (space_id, item, at)
  select space_id, item, created_at from space_members;
insert or ignore into once_shared (space_id, item, at)
  select space_id, item, created_at from guest_members where joined_at is not null;

insert or ignore into once_shared (space_id, item, at)
  select n.space_id, '', n.updated_at
    from notes n
    join spaces s on s.id = n.space_id
   where n.doc_by is not null and n.doc_by <> ''
     and n.doc_by not in (select id from devices where user_id = s.user_id)
     and n.doc_by not in ('user:' || s.user_id, 'program:' || s.user_id)
     and n.doc_by not in (select 'program:' || substr(token_hash, 1, 16) from mcp_tokens
                          where user_id = s.user_id)
     and n.doc_by not in (select 'program:' || substr(access_hash, 1, 16) from oauth_grants
                          where user_id = s.user_id)
     and n.doc_by not in (select 'session:' || substr(token_hash, 1, 16) from sessions
                          where user_id = s.user_id);
insert or ignore into once_shared (space_id, item, at)
  select n.space_id, '', n.updated_at
    from notes n
    join spaces s on s.id = n.space_id
   where n.updated_by is not null and n.updated_by <> ''
     and n.updated_by not in (select id from devices where user_id = s.user_id)
     and n.updated_by not in ('user:' || s.user_id, 'program:' || s.user_id)
     and n.updated_by not in (select 'program:' || substr(token_hash, 1, 16) from mcp_tokens
                          where user_id = s.user_id)
     and n.updated_by not in (select 'program:' || substr(access_hash, 1, 16) from oauth_grants
                          where user_id = s.user_id)
     and n.updated_by not in (select 'session:' || substr(token_hash, 1, 16) from sessions
                          where user_id = s.user_id);

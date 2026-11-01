-- Who could once write in a space, kept after they have gone. A member who leaves, or
-- is taken out, takes their row in space_members or guest_members with them, but not
-- the words they wrote: those stay in the owner's notes. So what marks a space's words
-- as somebody else's to a model (the connector, and the app through the listing) asks
-- this as well as who is in it now. `item` is '' for the whole space, else the note
-- that was shared on its own, as in space_members. A row goes only when the owner says
-- the space is theirs again (POST /v1/spaces/:id/share/trust).
create table once_shared (
  space_id text    not null references spaces(id) on delete cascade,
  item     text    not null default '',
  at       integer not null,
  primary key (space_id, item)
);

-- Everybody who is in a space today could write in it.
insert or ignore into once_shared (space_id, item, at)
  select space_id, item, created_at from space_members;
insert or ignore into once_shared (space_id, item, at)
  select space_id, item, created_at from guest_members where joined_at is not null;

-- And somebody who already left is still known by what they wrote: a note whose latest
-- words, or latest change, came from a writer that is not the owner's. A writer is a
-- device id, or `guest:<id>`, `session:<sha16>` or `program:<sha16>` (and before 0064
-- `program:<account>`); see src/sync2/device.ts. One that names none of the owner's
-- devices, sessions or tokens left now is counted as somebody else's: a session or a
-- token that has since gone cannot be told from another person's, and the owner can say
-- the space is theirs again.
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

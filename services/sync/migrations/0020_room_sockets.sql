-- Who has a file open right now, so that a revocation can reach them.
--
-- A room is a Durable Object named by the file's id, and there is no way to ask
-- the runtime which of them are awake. So the checks a socket was let in on -
-- this person is in this space, at this role - were made once at the handshake
-- and never again: an owner who took somebody out of a space watched them go on
-- typing into it until they closed the tab.
--
-- A room writes itself down here as a socket joins and takes the row away as it
-- closes, which turns "which rooms have to be told" into one query. The
-- alternative is telling every note of the space, which is thousands of objects
-- woken for the sake of two open editors.
--
-- One row per person per file rather than per socket: two devices of one person
-- in one file are one thing to tell, and the room knows which of its own sockets
-- are theirs.
create table room_sockets (
  note_id   text    not null,
  space_id  text    not null,
  -- The account or the guest, whichever the socket carries: the same value the
  -- door works out as `who`.
  who       text    not null,
  opened_at integer not null,
  primary key (note_id, who)
);

-- What a revocation asks: which files this person has open in this space.
create index room_sockets_space on room_sockets(space_id, who);

-- A row a room never got to take away - an object the runtime dropped without a
-- close - is cleared by age as new ones arrive, the way the sessions are.
create index room_sockets_opened on room_sockets(opened_at);

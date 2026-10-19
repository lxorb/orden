-- Note ids whose rows have gone for good, and which nothing may be made under again.
--
-- A note's id names more than its row: its room (a Durable Object), its body and its
-- document's snapshot in the bucket, the chat a `.chat` pointer opens. Those are
-- emptied after the row goes, from `leftovers`, and a sync v2 device chooses the ids
-- of what it makes. So a row taken away - a space purged from Recently deleted, an
-- account deleted - would leave its id free for somebody else's create, and with it
-- whatever the room still held. A purged note's row stays as a tombstone and answers
-- for its id itself; the ids whose rows do not stay are written here, and a create
-- under any of them is refused (src/sync2/ops.ts).
--
-- Each is kept until its room has been emptied and nothing else named by it is left in
-- `leftovers`, and no longer: after that a create under it is handed nothing, and an
-- account that was deleted leaves no row behind that names anything of it (see
-- src/leftovers.ts). An older Worker never reads the table and writes nothing it
-- would contradict.
create table if not exists retired_notes (
  id    text    primary key,
  since integer not null
);

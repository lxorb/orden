-- What a note said before, kept on the account so that any device can put it
-- back.
--
-- The device already keeps its own versions (see history.rs), but those are
-- keyed by the note's path on that machine: a rename orphans them, another
-- machine never sees them, and a laptop that dies takes them with it. The
-- account's copy is keyed by the note's id, which is the one name for a note
-- that every device agrees on.
--
-- A row per moment, and the body in R2 under `versions/<hash>`. The hash is the
-- key, so a note that flips between two states costs two objects however many
-- times it flips, and two notes that say the same thing cost one. Which is the
-- same arrangement the blobs table already uses for pictures.
--
-- `by` is the device as it named itself, for the row to say where a version came
-- from. Empty where nothing said.
create table note_versions (
  note_id text not null references notes(id) on delete cascade,
  at integer not null,
  hash text not null,
  size integer not null,
  by text not null default '',
  primary key (note_id, at)
);

-- Which rows a hash still has, for the sweep: an R2 object goes only when the
-- last row naming it has gone.
create index note_versions_hash on note_versions(hash);

-- And what the sweep walks: everything older than the month it keeps.
create index note_versions_at on note_versions(at);

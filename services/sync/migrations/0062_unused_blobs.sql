-- What a purge may have left nobody using.
--
-- A blob is held by a row of `blobs`, and the row is what counts against the account
-- and keeps the bytes in the bucket. Purging a note or a space for good took away what
-- used the bytes - a file of the tree, a page note's paper, a picture in a note, a file
-- the space listed - and left the owner's row, so what was purged went on counting and
-- went on being served, when "what is purged costs nothing" (src/storage.ts).
--
-- Whether the bytes are still used is not the purge's to decide on the spot: something
-- else of the owner's may show them, a space of somebody else's may, and a note written
-- before its pictures were written down cannot be asked yet. So the purge writes down,
-- with the rows it takes away, each hash and whose row to ask about, and the owner's
-- row is let go of from this list the way a give-back lets go of one (src/unused.ts):
-- a few right after the purge and the rest every night, a hash that cannot be decided
-- yet staying for the next.
create table unused_blobs (
  user_id text not null,
  hash text not null,
  since integer not null,
  primary key (user_id, hash)
);

-- The sweep takes the oldest first.
create index unused_blobs_since on unused_blobs(since);

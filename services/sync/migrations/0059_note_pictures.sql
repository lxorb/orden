-- The pictures each note shows, so that what a space uses can be asked of a row.
--
-- A picture is held by whoever uploaded it, and a writer in somebody else's space
-- uploads their own: deleting that writer's account has to hand the picture to the
-- owner of every space whose notes still show it (see src/erase.ts). The bodies are in
-- R2, one object per note, so that question could only be answered by reading every
-- note there is - and asking only the spaces the account was still a member of missed a
-- writer who had left, or been taken out, and a picture somebody unrelated had kept
-- alive until they went too. So the hashes a note's body names are written down here
-- every time a body is written, from the same place as its words and its reminders;
-- see src/pictures.ts.
--
-- One row per picture per note, rewritten whole on every save, so a picture taken out
-- of a note stops being one the space uses. The rows go with the note.
create table note_pictures (
  note_id text not null references notes(id) on delete cascade,
  hash text not null,
  primary key (note_id, hash)
);

-- The question a deleted account asks: which notes show this hash.
create index note_pictures_hash on note_pictures(hash);

-- And the same question of the two places a row names a blob by its hash: a file of a
-- space's tree (sync v2) and a page note's paper (0056). Partial, so each is only as big
-- as the notes that have one.
create index notes_file_hash on notes(hash) where kind = 'file';
create index notes_paper on notes(paper) where paper is not null;

-- Every note written before this has no rows yet. `front_rev` 2 says a note's pictures
-- were written down with its front and its words (src/blog/front.ts), so every note
-- below it is read again by the nightly sweep that already reads them (src/blog/fill.ts),
-- and until then a deleted account reads the bodies it can reach the old way.

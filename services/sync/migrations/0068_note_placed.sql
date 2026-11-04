-- Who last put a note where it is, kept apart from who last wrote in it (#1068).
--
-- A content change makes its writer the note's last changer (`updated_by`), and a folder
-- delete reads the notes inside by their last changer: a device that wrote in a note
-- somebody else had moved into the folder, never having seen it there, took it with the
-- folder, words and all. Written as words land, from the row as it stood: the cursor and
-- the device of the change before them, where that change was to the note's place.
--
-- Only added: a row without them answers as it always did, and an app or a Worker that
-- has never heard of them neither writes nor reads them.
alter table notes add column placed_seq integer;
alter table notes add column placed_by text;

-- The paper a page note holds (#551): the hash of its PDF, whose bytes are a blob like
-- any other (`blobs/<hash>`). A page note and its paper are one thing, kept by the
-- note's id rather than paired by name, so the paper reaches whoever reaches the note -
-- the account's other devices, on either sync, and somebody the note was shared with
-- on its own - and follows it through a rename, a move and Recently deleted without a
-- second row to keep in step. Null for a page note that holds no paper, which is every
-- page note somebody drew on blank sheets, and for every other kind of note.
alter table notes add column paper text;

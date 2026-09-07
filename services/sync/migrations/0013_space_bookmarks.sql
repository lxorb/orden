-- The notes, folders, headings and searches kept above a space's file list, as
-- one JSON array. On the space rather than on the account, because a bookmark
-- points into one space: it goes with the space when it is deleted, comes back
-- with it when it is restored, and is read by every device signed in.
alter table spaces add column bookmarks text not null default '[]';

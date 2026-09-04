-- Recently deleted: a deleted note or space is kept for a while rather than
-- emptied on the spot, so it can be put back. The stamp says since when; null
-- once it has been purged, or while it is alive.

alter table notes add column deleted_at integer;
alter table spaces add column deleted_at integer;

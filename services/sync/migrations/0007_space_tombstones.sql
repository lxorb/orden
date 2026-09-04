-- A deleted space leaves a marker behind rather than vanishing from the table.
--
-- Without one, a machine that was offline when the space was deleted comes back
-- holding a folder the account has never heard of, and cannot tell "deleted"
-- apart from "not uploaded yet" - so it uploads it again and the deletion is
-- undone everywhere. The marker is the difference between those two, and it is
-- what lets the deletion win.
alter table spaces add column deleted integer not null default 0;

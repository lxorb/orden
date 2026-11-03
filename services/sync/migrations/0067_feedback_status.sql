-- What a report sent with Send feedback is answered with (#1087): a page of its own that
-- says it arrived and how it stands, and the pictures that came with it.
--
-- The page's address carries a key only the sender is given; the row keeps its hash, so
-- the database alone opens no report's page. A report from before this has none, and no
-- page.
alter table feedback add column status_hash text;

-- One picture of one report: its bytes in the notes bucket under
-- `feedback/<feedback_id>/<name>`, served at `/v1/feedback/images/<name>` to whoever
-- holds the name, which is random and is written only into the report's issue and page.
-- Deleting the account deletes them with its reports (erase.ts).
create table feedback_images (
  name text primary key,
  feedback_id text not null,
  position integer not null,
  type text not null,
  size integer not null,
  created_at integer not null
);

create index feedback_images_of on feedback_images (feedback_id, position);

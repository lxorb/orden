alter table feedback add column status_hash text;

create table feedback_images (
  name text primary key,
  feedback_id text not null,
  position integer not null,
  type text not null,
  size integer not null,
  created_at integer not null
);

create index feedback_images_of on feedback_images (feedback_id, position);

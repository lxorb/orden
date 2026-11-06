create table room_sockets (
  note_id   text    not null,
  space_id  text    not null,
  who       text    not null,
  opened_at integer not null,
  primary key (note_id, who)
);

create index room_sockets_space on room_sockets(space_id, who);

create index room_sockets_opened on room_sockets(opened_at);

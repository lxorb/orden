update unused_blobs set since = cast(strftime('%s', 'now') as integer) * 1000;

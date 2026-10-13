-- Which reader read each email, and which last read each mailbox. When the
-- readers get better, mail read by an older one is read again (the last 30
-- days of it), and what it found is corrected in place: a train saved as
-- just "Train" gets its number, name and stations.
alter table mail_seen add column if not exists reader_version integer not null default 1;
alter table oauth_accounts add column if not exists mail_reader_version integer not null default 1;

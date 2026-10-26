-- Views run with their owner's rights, so bi_reader never needs the app
-- tables. It gets nothing in public, where approval_requests keeps the
-- full arguments of open requests.
GRANT USAGE ON SCHEMA bi TO bi_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA bi TO bi_reader;

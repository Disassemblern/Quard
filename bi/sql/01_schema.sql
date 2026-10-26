CREATE SCHEMA bi;

-- Power BI signs in as bi_reader. Roles belong to the server, not the
-- database, so it may exist already.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bi_reader') THEN
        CREATE ROLE bi_reader LOGIN;
    END IF;
END
$$;

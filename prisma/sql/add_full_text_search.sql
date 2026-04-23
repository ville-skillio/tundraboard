-- Full-text search migration for TundraBoard tasks
-- Apply with: psql $DATABASE_URL -f prisma/sql/add_full_text_search.sql

-- 1. Add the tsvector column (nullable; populated by trigger going forward)
ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS search_vector tsvector;

-- 2. Back-fill existing rows (coalesce guards against NULL description)
UPDATE tasks
SET search_vector = to_tsvector(
  'english',
  coalesce(title, '') || ' ' || coalesce(description, '')
);

-- 3. GIN index — required for @@ operator to be fast
CREATE INDEX IF NOT EXISTS tasks_search_vector_idx
  ON tasks USING GIN (search_vector);

-- 4. Trigger function: keeps search_vector in sync on INSERT/UPDATE
CREATE OR REPLACE FUNCTION tasks_search_vector_update()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_vector := to_tsvector(
    'english',
    coalesce(NEW.title, '') || ' ' || coalesce(NEW.description, '')
  );
  RETURN NEW;
END;
$$;

-- 5. Attach trigger (fires only when title or description changes)
DROP TRIGGER IF EXISTS tasks_search_vector_trigger ON tasks;
CREATE TRIGGER tasks_search_vector_trigger
  BEFORE INSERT OR UPDATE OF title, description
  ON tasks
  FOR EACH ROW EXECUTE FUNCTION tasks_search_vector_update();

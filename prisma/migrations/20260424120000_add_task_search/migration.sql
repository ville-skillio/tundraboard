-- Add full-text search vector column to tasks
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "search_vector" tsvector;

-- GIN index for fast full-text search
CREATE INDEX IF NOT EXISTS "tasks_search_vector_idx" ON "tasks" USING GIN ("search_vector");

-- Index on due_date for range filter performance
CREATE INDEX IF NOT EXISTS "tasks_due_date_idx" ON "tasks" ("due_date");

-- Trigger function: rebuild search_vector whenever title or description changes
CREATE OR REPLACE FUNCTION update_task_search_vector()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector =
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "task_search_vector_trigger" ON "tasks";
CREATE TRIGGER "task_search_vector_trigger"
  BEFORE INSERT OR UPDATE OF "title", "description"
  ON "tasks"
  FOR EACH ROW
  EXECUTE FUNCTION update_task_search_vector();

-- Backfill existing rows
UPDATE "tasks"
SET "search_vector" =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(description, '')), 'B');

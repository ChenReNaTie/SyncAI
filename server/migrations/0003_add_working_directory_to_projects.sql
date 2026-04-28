ALTER TABLE projects
ADD COLUMN IF NOT EXISTS working_directory TEXT;

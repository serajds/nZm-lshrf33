ALTER TABLE projects ADD COLUMN link_code text;

CREATE UNIQUE INDEX projects_link_code_normalized_unique
  ON projects (upper(btrim(link_code)));
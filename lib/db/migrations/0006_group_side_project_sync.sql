ALTER TABLE activity_groups ADD COLUMN linked_project_id integer;
ALTER TABLE activities ADD COLUMN managed_by_group_id integer;
ALTER TABLE activities ADD COLUMN managed_source_project_id integer;

CREATE UNIQUE INDEX activities_managed_source_unique
  ON activities (managed_by_group_id, external_source_group_id)
  WHERE managed_by_group_id IS NOT NULL AND external_source_group_id IS NOT NULL;
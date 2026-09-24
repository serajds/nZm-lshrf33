ALTER TABLE activity_groups ADD COLUMN link_code text;
CREATE UNIQUE INDEX activity_groups_link_code_unique ON activity_groups (link_code);
ALTER TABLE activities ADD COLUMN external_source_group_id integer;
CREATE INDEX activities_external_source_group_idx ON activities (external_source_group_id);
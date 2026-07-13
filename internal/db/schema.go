package db

const schemaSQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  avatar_color TEXT,
  avatar_image_id TEXT,
  git_username TEXT,
  git_email TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  flow_mode TEXT NOT NULL DEFAULT 'workspace',
  git_path TEXT,
  remote_url TEXT,
  default_branch TEXT,
  startup_script TEXT,
  copy_files TEXT,
  workline_settings TEXT,
  proxy_domain TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS worklines (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'root',
  branch TEXT,
  worktree_path TEXT,
  base_branch TEXT,
  parent_workline_id TEXT REFERENCES worklines(id) ON DELETE SET NULL,
  fork_point TEXT,
  merged_into_workline_id TEXT REFERENCES worklines(id) ON DELETE SET NULL,
  merge_commit_sha TEXT,
  merge_strategy TEXT,
  pre_merge_target_sha TEXT,
  container_config TEXT,
  exploration_group_id TEXT,
  is_root INTEGER NOT NULL DEFAULT 0,
  head_commit_sha TEXT,
  start_commit_sha TEXT,
  commit_count INTEGER NOT NULL DEFAULT 0,
  color TEXT,
  group_label TEXT,
  pinned INTEGER NOT NULL DEFAULT 0,
  position_x REAL,
  position_y REAL,
  panel_expanded INTEGER,
  panel_width REAL,
  panel_height REAL,
  review_source_workline_id TEXT,
  review_status TEXT,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_worklines_project ON worklines(project_id);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  workline_id TEXT REFERENCES worklines(id) ON DELETE SET NULL,
  api_conversation_id TEXT,
  fork_message_id TEXT,
  type TEXT NOT NULL DEFAULT 'primary',
  subagent_type TEXT,
  title TEXT NOT NULL,
  inherit_mode TEXT,
  parent_agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  context_summary TEXT,
  model TEXT NOT NULL,
  system_prompt TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
  previous_permission_mode TEXT,
  entity_generation INTEGER NOT NULL DEFAULT 1,
  permission_generation INTEGER NOT NULL DEFAULT 1,
  reasoning_effort TEXT,
  fast_mode INTEGER NOT NULL DEFAULT 0,
  relaxed_plan INTEGER NOT NULL DEFAULT 0,
  message_count INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  last_message_at TEXT,
  status TEXT NOT NULL DEFAULT 'idle',
  plan_mode INTEGER NOT NULL DEFAULT 0,
  cwd TEXT,
  error_message TEXT,
  todos_json TEXT,
  todos_tool_use_id TEXT,
  prune_boundary_message_id TEXT,
  pruned_percent INTEGER,
  prune_enabled INTEGER NOT NULL DEFAULT 0,
  is_background INTEGER NOT NULL DEFAULT 0,
  background_status TEXT,
  background_result TEXT,
  background_completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_workline ON agents(workline_id);
CREATE INDEX IF NOT EXISTS idx_agents_parent ON agents(parent_agent_id);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  trigger_message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'running',
  started_at TEXT NOT NULL,
  completed_at TEXT,
  error_message TEXT,
  base_head TEXT,
  end_head TEXT,
  checkpoint_repo_root TEXT,
  git_snapshot_at TEXT,
  checkpoint_state TEXT NOT NULL DEFAULT 'none',
  checkpoint_error TEXT,
  rolled_back_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_agent_started ON runs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);

CREATE TABLE IF NOT EXISTS run_git_changes (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  orig_path TEXT,
  index_status TEXT NOT NULL,
  worktree_status TEXT NOT NULL,
  untracked INTEGER NOT NULL DEFAULT 0,
  index_fingerprint TEXT,
  worktree_fingerprint TEXT NOT NULL,
  PRIMARY KEY (run_id, path)
);
CREATE INDEX IF NOT EXISTS idx_run_git_changes_run ON run_git_changes(run_id, path);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  sdk_message_uuid TEXT,
  parent_tool_use_id TEXT,
  role TEXT NOT NULL,
  content_json TEXT,
  content_text TEXT,
  tokens_in INTEGER,
  cost_usd REAL,
  turn_usage_json TEXT,
  context_percent REAL,
  meter_usage REAL,
  meter_unit TEXT,
  commit_sha TEXT,
  command_text TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_agent_time ON agent_messages(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_run ON agent_messages(run_id, created_at);

CREATE TABLE IF NOT EXISTS agent_message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT,
  kind TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  data_blob BLOB NOT NULL,
  extracted_text TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_attachments_message ON agent_message_attachments(message_id, created_at);
CREATE INDEX IF NOT EXISTS idx_message_attachments_agent ON agent_message_attachments(agent_id, created_at);

CREATE TABLE IF NOT EXISTS agent_tool_calls (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  tool_use_id TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  input_json TEXT,
  output_json TEXT,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  error_message TEXT,
  permission_decided_by TEXT,
  permission_decided_at TEXT,
  permission_deny_message TEXT,
  permission_decision_reason TEXT,
  permission_suggestions TEXT,
  permission_generation INTEGER NOT NULL DEFAULT 1,
  policy_generation INTEGER NOT NULL DEFAULT 1,
  is_background INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_cost REAL,
  provider TEXT,
  model TEXT,
  result_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON agent_tool_calls(agent_id, created_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run ON agent_tool_calls(run_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_tool_use ON agent_tool_calls(agent_id, tool_use_id);

CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  agent_id TEXT REFERENCES agents(id) ON DELETE SET NULL,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES agent_messages(id) ON DELETE SET NULL,
  kind TEXT NOT NULL DEFAULT 'model',
  provider TEXT,
  credential_id TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cached_input_tokens INTEGER,
  reasoning_tokens INTEGER,
  ttft_ms INTEGER,
  duration_ms INTEGER,
  cost_usd REAL,
  context_percent REAL,
  meter_usage REAL,
  meter_unit TEXT,
  error_message TEXT,
  raw_dump_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_api_requests_run ON api_requests(run_id, created_at);

CREATE TABLE IF NOT EXISTS agent_backends (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'local',
  base_url TEXT NOT NULL,
  api_key TEXT,
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_backends_active ON agent_backends(active);

CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  transport TEXT NOT NULL DEFAULT 'stdio',
  command TEXT NOT NULL,
  args_json TEXT,
  cwd TEXT,
  env_json TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mcp_servers_enabled ON mcp_servers(enabled);

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT 'global',
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  workline_id TEXT REFERENCES worklines(id) ON DELETE CASCADE,
  deleted_at TEXT,
  revision_no INTEGER NOT NULL DEFAULT 1,
  content_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 0,
  scan_verdict TEXT NOT NULL,
  scan_findings_json TEXT NOT NULL DEFAULT '[]',
  scanner_version INTEGER NOT NULL DEFAULT 0,
  risk_acknowledged_at TEXT,
  risk_acknowledged_by TEXT,
  risk_acknowledged_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (source IN ('manual', 'local_migration', 'skill_md')),
  CHECK (scope IN ('global', 'project', 'workspace')),
  CHECK ((scope = 'global' AND project_id IS NULL AND workline_id IS NULL) OR (scope = 'project' AND project_id IS NOT NULL AND workline_id IS NULL) OR (scope = 'workspace' AND project_id IS NOT NULL AND workline_id IS NOT NULL)),
  CHECK (revision_no >= 1),
  CHECK (scan_verdict IN ('safe', 'review', 'blocked')),
  CHECK (enabled IN (0, 1)),
  CHECK (NOT (scan_verdict = 'blocked' AND enabled = 1)),
  CHECK (NOT (scan_verdict = 'review' AND enabled = 1 AND (TRIM(COALESCE(risk_acknowledged_at, ''), ' ' || char(9) || char(10) || char(11) || char(12) || char(13)) = '' OR TRIM(COALESCE(risk_acknowledged_by, ''), ' ' || char(9) || char(10) || char(11) || char(12) || char(13)) = '' OR COALESCE(risk_acknowledged_hash, '') <> content_hash)))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_global_command ON skills(command COLLATE NOCASE) WHERE deleted_at IS NULL AND scope = 'global';
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_project_command ON skills(project_id, command COLLATE NOCASE) WHERE deleted_at IS NULL AND scope = 'project';
CREATE UNIQUE INDEX IF NOT EXISTS idx_skills_workspace_command ON skills(workline_id, command COLLATE NOCASE) WHERE deleted_at IS NULL AND scope = 'workspace';
CREATE INDEX IF NOT EXISTS idx_skills_scope_command ON skills(scope, project_id, workline_id, command COLLATE NOCASE, id) WHERE deleted_at IS NULL;

CREATE TRIGGER IF NOT EXISTS skills_workspace_scope_insert
BEFORE INSERT ON skills
WHEN NEW.scope = 'workspace' AND NOT EXISTS (SELECT 1 FROM worklines WHERE id = NEW.workline_id AND project_id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'workspace skill must reference a workline in the selected project');
END;
CREATE TRIGGER IF NOT EXISTS skills_workspace_scope_update
BEFORE UPDATE OF scope, project_id, workline_id ON skills
WHEN NEW.scope = 'workspace' AND NOT EXISTS (SELECT 1 FROM worklines WHERE id = NEW.workline_id AND project_id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'workspace skill must reference a workline in the selected project');
END;

CREATE TABLE IF NOT EXISTS skill_revisions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  operation TEXT NOT NULL,
  actor TEXT NOT NULL,
  restored_from_revision_no INTEGER,
  name TEXT NOT NULL,
  command TEXT NOT NULL COLLATE NOCASE,
  description TEXT NOT NULL,
  prompt TEXT NOT NULL,
  source TEXT NOT NULL,
  scope TEXT NOT NULL,
  project_id TEXT,
  workline_id TEXT,
  deleted_at TEXT,
  content_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL,
  scan_verdict TEXT NOT NULL,
  scan_findings_json TEXT NOT NULL,
  scanner_version INTEGER NOT NULL,
  risk_acknowledged_at TEXT,
  risk_acknowledged_by TEXT,
  risk_acknowledged_hash TEXT,
  head_created_at TEXT NOT NULL,
  head_updated_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(skill_id, revision_no),
  CHECK (operation IN ('baseline', 'create', 'update', 'delete', 'restore', 'revalidate')),
  CHECK (scope IN ('global', 'project', 'workspace')),
  CHECK (enabled IN (0, 1)),
  CHECK (scan_verdict IN ('safe', 'review', 'blocked'))
);
CREATE INDEX IF NOT EXISTS idx_skill_revisions_skill_revision ON skill_revisions(skill_id, revision_no DESC);
CREATE INDEX IF NOT EXISTS idx_skill_revisions_snapshot ON skill_revisions(sequence, skill_id);

CREATE TABLE IF NOT EXISTS skill_audit_events (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  scan_verdict TEXT NOT NULL,
  finding_codes_json TEXT NOT NULL DEFAULT '[]',
  risk_acknowledged_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (action IN ('create', 'update', 'enable', 'disable', 'delete', 'restore'))
);
CREATE INDEX IF NOT EXISTS idx_skill_audit_events_skill_created ON skill_audit_events(skill_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS notification_settings (
  id TEXT PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  webhook_url TEXT,
  notify_on_approval INTEGER NOT NULL DEFAULT 1,
  notify_on_done INTEGER NOT NULL DEFAULT 1,
  notify_on_error INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflow_preferences (
  id TEXT PRIMARY KEY,
  require_confirmation_for_exec INTEGER NOT NULL DEFAULT 1,
  require_confirmation_for_writes INTEGER NOT NULL DEFAULT 0,
  allow_read_only_by_default INTEGER NOT NULL DEFAULT 1,
  policy_generation INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_permission_rules (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL DEFAULT '*',
  tool_name TEXT NOT NULL DEFAULT '*',
  risk TEXT NOT NULL DEFAULT '*',
  decision TEXT NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_permission_rules_match ON tool_permission_rules(enabled, mode, tool_name, risk, priority);
`

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
  chapter_settings TEXT,
  proxy_domain TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  role TEXT NOT NULL DEFAULT 'root',
  branch TEXT,
  worktree_path TEXT,
  base_branch TEXT,
  parent_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  fork_point TEXT,
  merged_into_chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
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
  review_source_chapter_id TEXT,
  review_status TEXT,
  last_accessed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id);

CREATE TABLE IF NOT EXISTS narrators (
  id TEXT PRIMARY KEY,
  chapter_id TEXT REFERENCES chapters(id) ON DELETE SET NULL,
  api_conversation_id TEXT,
  fork_message_id TEXT,
  type TEXT NOT NULL DEFAULT 'primary',
  subagent_type TEXT,
  title TEXT NOT NULL,
  inherit_mode TEXT,
  parent_narrator_id TEXT REFERENCES narrators(id) ON DELETE SET NULL,
  context_summary TEXT,
  model TEXT NOT NULL,
  system_prompt TEXT,
  permission_mode TEXT NOT NULL DEFAULT 'acceptEdits',
  previous_permission_mode TEXT,
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
CREATE INDEX IF NOT EXISTS idx_narrators_chapter ON narrators(chapter_id);
CREATE INDEX IF NOT EXISTS idx_narrators_parent ON narrators(parent_narrator_id);

CREATE TABLE IF NOT EXISTS narrator_messages (
  id TEXT PRIMARY KEY,
  narrator_id TEXT NOT NULL REFERENCES narrators(id) ON DELETE CASCADE,
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
CREATE INDEX IF NOT EXISTS idx_narrator_messages_narrator_time ON narrator_messages(narrator_id, created_at);

CREATE TABLE IF NOT EXISTS narrator_tool_calls (
  id TEXT PRIMARY KEY,
  narrator_id TEXT NOT NULL REFERENCES narrators(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES narrator_messages(id) ON DELETE SET NULL,
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
  is_background INTEGER NOT NULL DEFAULT 0,
  input_tokens INTEGER,
  output_tokens INTEGER,
  total_cost REAL,
  provider TEXT,
  model TEXT,
  result_message_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_narrator ON narrator_tool_calls(narrator_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tool_calls_tool_use ON narrator_tool_calls(narrator_id, tool_use_id);

CREATE TABLE IF NOT EXISTS api_requests (
  id TEXT PRIMARY KEY,
  narrator_id TEXT REFERENCES narrators(id) ON DELETE SET NULL,
  message_id TEXT REFERENCES narrator_messages(id) ON DELETE SET NULL,
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

CREATE TABLE IF NOT EXISTS background_tasks (
  id TEXT PRIMARY KEY,
  parent_narrator_id TEXT REFERENCES narrators(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  command TEXT,
  exit_code INTEGER,
  subagent_narrator_id TEXT REFERENCES narrators(id) ON DELETE SET NULL,
  subagent_type TEXT,
  tool_use_id TEXT,
  alias TEXT,
  title TEXT,
  output TEXT,
  output_bytes INTEGER,
  output_truncated INTEGER NOT NULL DEFAULT 0,
  notified INTEGER NOT NULL DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`

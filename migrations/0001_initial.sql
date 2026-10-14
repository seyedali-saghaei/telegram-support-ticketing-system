-- Fresh-install schema. Apply to an empty Cloudflare D1 database.
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_chat_id TEXT NOT NULL,
  telegram_message_id INTEGER NOT NULL,
  board_message_id INTEGER,
  category TEXT NOT NULL,
  message_text TEXT NOT NULL,
  status TEXT DEFAULT 'Open',
  reply_text TEXT,
  replied_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  replied_at TEXT,
  board_reply_message_id INTEGER,
  delivery_error TEXT,
  acknowledgement_sent_at TEXT,
  telegram_username TEXT,
  program_name TEXT,
  message_type TEXT NOT NULL DEFAULT 'text',
  telegram_file_id TEXT,
  telegram_first_name TEXT,
  telegram_last_name TEXT,
  UNIQUE(telegram_chat_id, telegram_message_id)
);
CREATE TABLE IF NOT EXISTS conversations (
  chat_id TEXT PRIMARY KEY,
  category TEXT,
  program_name TEXT,
  step TEXT NOT NULL DEFAULT 'category',
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS message_replies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  admin_user_id TEXT NOT NULL,
  admin_name TEXT,
  reply_text TEXT,
  reply_type TEXT NOT NULL DEFAULT 'text',
  telegram_file_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE TABLE IF NOT EXISTS reply_sources (
  reply_id INTEGER PRIMARY KEY,
  board_message_id INTEGER NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS delivery_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_type TEXT NOT NULL,
  message_id INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(job_type, message_id)
);
CREATE TABLE IF NOT EXISTS message_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  media_type TEXT NOT NULL,
  telegram_file_id TEXT NOT NULL,
  board_message_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id)
);
CREATE TABLE IF NOT EXISTS blocked_users (
  telegram_chat_id TEXT PRIMARY KEY,
  telegram_username TEXT,
  blocked_by TEXT,
  blocked_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS user_rate_limits (
  chat_id TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  message_count INTEGER NOT NULL DEFAULT 0,
  muted_until INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  processed_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_messages_board_message_id ON messages(board_message_id);
CREATE INDEX IF NOT EXISTS idx_message_replies_message_id ON message_replies(message_id);
CREATE INDEX IF NOT EXISTS idx_delivery_jobs_state ON delivery_jobs(state, id);
CREATE INDEX IF NOT EXISTS idx_message_media_message_id ON message_media(message_id);

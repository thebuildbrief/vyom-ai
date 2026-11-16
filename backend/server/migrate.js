const migrations=[
  {version:1,sql:`CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS interviews(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),role TEXT,type TEXT,difficulty TEXT,duration INTEGER,interviewer TEXT,language TEXT,company TEXT,topics TEXT,resume_id TEXT,status TEXT DEFAULT 'active',created_at TEXT DEFAULT CURRENT_TIMESTAMP,finished_at TEXT);
    CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,interview_id TEXT NOT NULL REFERENCES interviews(id),user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS resumes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),filename TEXT NOT NULL,path TEXT NOT NULL,extracted_text TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,interview_id TEXT UNIQUE REFERENCES interviews(id),user_id TEXT NOT NULL REFERENCES users(id),overall_score INTEGER,details TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,interview_id TEXT NOT NULL REFERENCES interviews(id),user_id TEXT NOT NULL REFERENCES users(id),language TEXT,source TEXT,result TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_interviews_user_created ON interviews(user_id,created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_messages_interview_created ON messages(interview_id,created_at);`},
  {version:2,sql:`CREATE TABLE IF NOT EXISTS user_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),education TEXT DEFAULT '',college TEXT DEFAULT '',graduation_year INTEGER,skills TEXT DEFAULT '',experience_level TEXT DEFAULT '',preferred_role TEXT DEFAULT '',programming_languages TEXT DEFAULT '[]',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS auth_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS coding_test_results(id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES submissions(id),user_id TEXT NOT NULL REFERENCES users(id),test_index INTEGER NOT NULL,passed INTEGER NOT NULL,expected TEXT,actual TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);`},
  {version:3,sql:`CREATE TABLE IF NOT EXISTS friendships(id TEXT PRIMARY KEY,requester_id TEXT NOT NULL REFERENCES users(id),addressee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(requester_id,addressee_id));
    CREATE INDEX IF NOT EXISTS idx_friendships_addressee_status ON friendships(addressee_id,status);
    CREATE TABLE IF NOT EXISTS study_rooms(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,join_code TEXT NOT NULL UNIQUE,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS study_room_members(room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),joined_at TEXT DEFAULT CURRENT_TIMESTAMP,last_seen_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(room_id,user_id));
    CREATE TABLE IF NOT EXISTS study_room_messages(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),content TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_study_room_messages_room_created ON study_room_messages(room_id,created_at);`},
  {version:4,sql:`CREATE TABLE IF NOT EXISTS study_room_sessions(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),started_at TEXT NOT NULL,ended_at TEXT,last_heartbeat_at TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS idx_study_room_sessions_room_start ON study_room_sessions(room_id,started_at);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_study_room_sessions_one_active ON study_room_sessions(room_id,user_id) WHERE ended_at IS NULL;`},
  {version:5,sql:''},
  {version:6,sql:''},
  {version:7,sql:`CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_study_room_sessions_user_start ON study_room_sessions(user_id,started_at);
    CREATE INDEX IF NOT EXISTS idx_study_room_members_user ON study_room_members(user_id);
    CREATE INDEX IF NOT EXISTS idx_friendships_requester_status ON friendships(requester_id,status);
    CREATE INDEX IF NOT EXISTS idx_resumes_user_created ON resumes(user_id,created_at);`},
  {version:8,sql:`CREATE TABLE IF NOT EXISTS study_room_events(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),type TEXT NOT NULL,detail TEXT DEFAULT '',created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE INDEX IF NOT EXISTS idx_study_room_events_room_created ON study_room_events(room_id,created_at);`}
];
const pgSchema = `CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,email_verified BOOLEAN NOT NULL DEFAULT FALSE,google_sub TEXT UNIQUE,profile_image TEXT);
CREATE TABLE IF NOT EXISTS interviews(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),role TEXT,type TEXT,difficulty TEXT,duration INTEGER,interviewer TEXT,language TEXT,company TEXT,topics TEXT,resume_id TEXT,experience_level TEXT NOT NULL DEFAULT '',interview_language TEXT NOT NULL DEFAULT 'English',status TEXT DEFAULT 'active',created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,finished_at TIMESTAMPTZ,finish_started_at TIMESTAMPTZ);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,interview_id TEXT NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),role TEXT NOT NULL,content TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS resumes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),filename TEXT NOT NULL,path TEXT NOT NULL,extracted_text TEXT DEFAULT '',analysis TEXT NOT NULL DEFAULT '',mime_type TEXT NOT NULL DEFAULT 'application/pdf',size_bytes INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,interview_id TEXT UNIQUE REFERENCES interviews(id),user_id TEXT NOT NULL REFERENCES users(id),overall_score INTEGER,details TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS submissions(id TEXT PRIMARY KEY,interview_id TEXT NOT NULL REFERENCES interviews(id),user_id TEXT NOT NULL REFERENCES users(id),language TEXT,source TEXT,result TEXT,problem_key TEXT NOT NULL DEFAULT '',mode TEXT NOT NULL DEFAULT 'run',created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS user_profiles(user_id TEXT PRIMARY KEY REFERENCES users(id),education TEXT DEFAULT '',college TEXT DEFAULT '',graduation_year INTEGER,skills TEXT DEFAULT '',experience_level TEXT DEFAULT '',preferred_role TEXT DEFAULT '',programming_languages TEXT DEFAULT '[]',updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS auth_tokens(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),token_hash TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,expires_at TIMESTAMPTZ NOT NULL,used_at TIMESTAMPTZ,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS coding_test_results(id TEXT PRIMARY KEY,submission_id TEXT NOT NULL REFERENCES submissions(id),user_id TEXT NOT NULL REFERENCES users(id),test_index INTEGER NOT NULL,passed BOOLEAN NOT NULL,expected TEXT,actual TEXT,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS friendships(id TEXT PRIMARY KEY,requester_id TEXT NOT NULL REFERENCES users(id),addressee_id TEXT NOT NULL REFERENCES users(id),status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,UNIQUE(requester_id,addressee_id));
CREATE INDEX IF NOT EXISTS idx_friendships_addressee_status ON friendships(addressee_id,status);
CREATE TABLE IF NOT EXISTS study_rooms(id TEXT PRIMARY KEY,owner_id TEXT NOT NULL REFERENCES users(id),name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',visibility TEXT NOT NULL DEFAULT 'private',join_code TEXT NOT NULL UNIQUE,pomodoro_phase TEXT NOT NULL DEFAULT 'focus',pomodoro_duration INTEGER NOT NULL DEFAULT 1500,pomodoro_started_at TIMESTAMPTZ,pomodoro_elapsed INTEGER NOT NULL DEFAULT 0,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS study_room_members(room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,last_seen_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(room_id,user_id));
CREATE TABLE IF NOT EXISTS study_room_messages(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),content TEXT NOT NULL,created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_study_room_messages_room_created ON study_room_messages(room_id,created_at);
CREATE TABLE IF NOT EXISTS study_room_sessions(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT NOT NULL REFERENCES users(id),started_at TIMESTAMPTZ NOT NULL,ended_at TIMESTAMPTZ,last_heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_study_room_sessions_room_start ON study_room_sessions(room_id,started_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_study_room_sessions_one_active ON study_room_sessions(room_id,user_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS study_room_events(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),type TEXT NOT NULL,detail TEXT DEFAULT '',created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP);
CREATE INDEX IF NOT EXISTS idx_study_room_events_room_created ON study_room_events(room_id,created_at);
CREATE INDEX IF NOT EXISTS idx_interviews_user_created ON interviews(user_id,created_at DESC); CREATE INDEX IF NOT EXISTS idx_messages_interview_created ON messages(interview_id,created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_user_created ON submissions(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id,created_at);
CREATE INDEX IF NOT EXISTS idx_study_room_sessions_user_start ON study_room_sessions(user_id,started_at);
CREATE INDEX IF NOT EXISTS idx_study_room_members_user ON study_room_members(user_id);
CREATE INDEX IF NOT EXISTS idx_friendships_requester_status ON friendships(requester_id,status);
CREATE INDEX IF NOT EXISTS idx_resumes_user_created ON resumes(user_id,created_at);`;
const sqliteColumnUpgrades=[
  ['users','email_verified','INTEGER NOT NULL DEFAULT 0'],
  ['users','google_sub','TEXT'],
  ['users','profile_image','TEXT'],
  ['resumes','analysis',"TEXT NOT NULL DEFAULT ''"],
  ['resumes','mime_type',"TEXT NOT NULL DEFAULT 'application/pdf'"],
  ['resumes','size_bytes','INTEGER NOT NULL DEFAULT 0'],
  ['interviews','experience_level',"TEXT NOT NULL DEFAULT ''"],
  ['interviews','interview_language',"TEXT NOT NULL DEFAULT 'English'"],
  ['interviews','finish_started_at','TEXT'],
  ['submissions','problem_key',"TEXT NOT NULL DEFAULT ''"],
  ['submissions','mode',"TEXT NOT NULL DEFAULT 'run'"],
  ['study_rooms','description',"TEXT NOT NULL DEFAULT ''"],
  ['study_rooms','visibility',"TEXT NOT NULL DEFAULT 'private'"],
  ['study_rooms','pomodoro_phase',"TEXT NOT NULL DEFAULT 'focus'"],
  ['study_rooms','pomodoro_duration','INTEGER NOT NULL DEFAULT 1500'],
  ['study_rooms','pomodoro_started_at','TEXT'],
  ['study_rooms','pomodoro_elapsed','INTEGER NOT NULL DEFAULT 0']
];
function ensureSqliteColumns(db){
  for(const [table,column,definition] of sqliteColumnUpgrades){
    if(!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table))continue;
    const columns=new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(x=>x.name));
    if(!columns.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
export function migrate(db){
  if(db.dialect==='postgres')return (async()=>{await db.exec(pgSchema);await db.exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE");await db.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT');await db.exec('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image TEXT');await db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL');await db.exec("ALTER TABLE resumes ADD COLUMN IF NOT EXISTS analysis TEXT NOT NULL DEFAULT ''");await db.exec("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS experience_level TEXT NOT NULL DEFAULT ''");await db.exec("ALTER TABLE interviews ADD COLUMN IF NOT EXISTS interview_language TEXT NOT NULL DEFAULT 'English'");await db.exec("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS problem_key TEXT NOT NULL DEFAULT ''");await db.exec("ALTER TABLE submissions ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'run'");await db.exec('CREATE INDEX IF NOT EXISTS idx_submissions_user_created ON submissions(user_id,created_at DESC)');await db.exec("ALTER TABLE resumes ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/pdf'");await db.exec('ALTER TABLE resumes ADD COLUMN IF NOT EXISTS size_bytes INTEGER NOT NULL DEFAULT 0');await db.exec('ALTER TABLE interviews ADD COLUMN IF NOT EXISTS finish_started_at TIMESTAMPTZ');await db.exec('CREATE INDEX IF NOT EXISTS idx_reports_user_created ON reports(user_id,created_at)');await db.exec('CREATE INDEX IF NOT EXISTS idx_study_room_sessions_user_start ON study_room_sessions(user_id,started_at)');await db.exec('CREATE INDEX IF NOT EXISTS idx_study_room_members_user ON study_room_members(user_id)');await db.exec('CREATE INDEX IF NOT EXISTS idx_friendships_requester_status ON friendships(requester_id,status)');await db.exec('CREATE INDEX IF NOT EXISTS idx_resumes_user_created ON resumes(user_id,created_at)');await db.exec("ALTER TABLE study_rooms ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''");await db.exec("ALTER TABLE study_rooms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'");await db.exec("ALTER TABLE study_rooms ADD COLUMN IF NOT EXISTS pomodoro_phase TEXT NOT NULL DEFAULT 'focus'");await db.exec('ALTER TABLE study_rooms ADD COLUMN IF NOT EXISTS pomodoro_duration INTEGER NOT NULL DEFAULT 1500');await db.exec('ALTER TABLE study_rooms ADD COLUMN IF NOT EXISTS pomodoro_started_at TIMESTAMPTZ');await db.exec('ALTER TABLE study_rooms ADD COLUMN IF NOT EXISTS pomodoro_elapsed INTEGER NOT NULL DEFAULT 0');await db.exec('CREATE TABLE IF NOT EXISTS study_room_events(id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES study_rooms(id) ON DELETE CASCADE,user_id TEXT REFERENCES users(id),type TEXT NOT NULL,detail TEXT DEFAULT \'\',created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)');await db.exec('CREATE INDEX IF NOT EXISTS idx_study_room_events_room_created ON study_room_events(room_id,created_at)');await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP)');const record=db.prepare('INSERT INTO schema_migrations(version) VALUES(?) ON CONFLICT(version) DO NOTHING');await record.run(1);await record.run(2);await record.run(3);await record.run(4);await record.run(5);await record.run(6);await record.run(7);await record.run(8);})();
  db.pragma('foreign_keys = ON');db.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  for(const migration of migrations){
    if(db.prepare('SELECT version FROM schema_migrations WHERE version=?').get(migration.version))continue;
    db.transaction(()=>{
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations(version) VALUES(?)').run(migration.version);
    })();
  }
  ensureSqliteColumns(db);
}

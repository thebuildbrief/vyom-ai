import { config } from 'dotenv';

// Neon CLI writes provider variables to .env.local. Load it first, then .env,
// while keeping any already-exported process environment values authoritative.
config({ path: ['.env.local', '.env'] });

import { config } from 'dotenv';

// Neon CLI writes provider variables to .env.local. Support both the backend
// project folder and the repository root used by the original single-folder setup.
config({ path: ['.env.local', '.env', '../.env.local', '../.env'] });

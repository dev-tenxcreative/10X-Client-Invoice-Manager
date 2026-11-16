import { config } from "dotenv";
import { existsSync } from "node:fs";

// Same precedence as Next.js: .env.local overrides .env. Real environment variables win.
if (existsSync(".env.local")) config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });

import { migrate } from "drizzle-orm/postgres-js/migrator";
import { db } from "./index";
import path from "path";
async function runMigrations() {
  try {
    await migrate(db, { migrationsFolder: path.resolve(process.cwd(), "drizzle") });
  } catch (error) { process.exitCode = 1; }
}
runMigrations();

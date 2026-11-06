import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
let _db: PostgresJsDatabase<typeof schema> | null = null;
function getDbInstance(): PostgresJsDatabase<typeof schema> {
  if (_db) return _db;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Missing required DATABASE_URL environment variable");
  _db = drizzle(postgres(connectionString, { max: 10, prepare: false }), { schema });
  return _db;
}
export const db: PostgresJsDatabase<typeof schema> = new Proxy({} as PostgresJsDatabase<typeof schema>, {
  get(_t, prop, rec) {
    const inst = getDbInstance();
    const val = Reflect.get(inst, prop, rec);
    return typeof val === "function" ? val.bind(inst) : val;
  }
});
export type Database = typeof db;

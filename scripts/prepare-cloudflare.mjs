import fs from "node:fs";
import path from "node:path";

// Opt-in only: Sites builds retain their original placeholder binding.
const filename = path.resolve("dist/server/wrangler.json");
const config = JSON.parse(fs.readFileSync(filename, "utf8"));
const databaseId = process.env.CLOUDFLARE_D1_DATABASE_ID || "9efeb673-7c87-4867-9bf9-b4c08085e021";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(databaseId) ||
    databaseId === "00000000-0000-4000-8000-000000000000") {
  throw new Error("A real D1 database ID is required.");
}
const db = config.d1_databases?.find((binding) => binding.binding === "DB");
if (!db) throw new Error("Generated Worker configuration has no DB binding.");
config.name = "seoul-apt-trade-dashboard";
config.workers_dev = true;
config.keep_vars = true;
db.database_id = databaseId;
db.database_name = "seoul-apt-dashboard-db";
db.migrations_dir = "../../drizzle";
fs.writeFileSync(filename, JSON.stringify(config, null, 2) + "\n");
console.log("Prepared standalone Cloudflare Worker and DB binding.");

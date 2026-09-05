import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";
import { getRuntimeD1 } from "./runtime";

export function getD1(): D1Database {
  const binding = getRuntimeD1();
  if (!binding) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return binding;
}

export function getD1OrNull(): D1Database | null {
  return getRuntimeD1();
}

export function getDb() {
  return drizzle(getD1(), { schema });
}

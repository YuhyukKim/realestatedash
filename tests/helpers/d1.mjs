import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

export function database() {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys=ON");
  for (const name of readdirSync(new URL("../../drizzle/", import.meta.url)).filter(name => name.endsWith(".sql")).sort()) {
    db.exec(readFileSync(new URL("../../drizzle/" + name, import.meta.url), "utf8"));
  }
  const statements = [];
  function execute(statement) {
    statements.push(statement.sql);
    const prepared = db.prepare(statement.sql);
    if (prepared.columns().length) return { results: prepared.all(...statement.values), meta: { changes: 0 } };
    const result = prepared.run(...statement.values);
    return { results: [], meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
  const d1 = {
    prepare(sql) {
      return { sql, values: [], bind(...values) { this.values = values; return this; },
        async first(column) { const row = execute(this).results[0] ?? null; return column && row ? row[column] : row; },
        async all() { return execute(this); },
        async run() { return execute(this); },
      };
    },
    async batch(batch) {
      db.exec("BEGIN");
      try { const results = batch.map(execute); db.exec("COMMIT"); return results; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  };
  return { db, d1, statements };
}

// scripts/run-property-batches.mjs
import fs from "node:fs";
import { spawnSync } from "node:child_process";

// server/property-batch-policy.mjs
function propertyBatchContinuation(summary) {
  if (!summary.requestBudgetReached) return null;
  if ((summary.apiErrors || []).some((e) => ["20", "22", "23", "30", "31"].includes(String(e.code)))) return null;
  const retry = (summary.results || []).filter((r) => [r.building, r.prices, r.buildingRefresh, r.priceRefresh].includes("rate_limited")).map((r) => String(r.id));
  return [.../* @__PURE__ */ new Set([...(summary.pending || []).map(String), ...retry])];
}

// scripts/run-property-batches.mjs
var catalog = JSON.parse(fs.readFileSync("data/parcel-candidates.json", "utf8"));
var input = (process.env.PROPERTY_PROJECT_IDS || "").split(",").filter(Boolean);
var scope = catalog.filter((c) => c.pnu && (!input.length || input.includes(String(c.id)))).map((c) => c.id);
var script = fs.existsSync("scripts/collect-map-properties.mjs") ? "scripts/collect-map-properties.mjs" : "scripts/collect-official-buildings.mjs";
var file = "data/property/collection-run.json";
var run = { startedAt: (/* @__PURE__ */ new Date()).toISOString(), workflowRunId: process.env.GITHUB_RUN_ID || null, scope, scopeCount: scope.length, batches: [], status: "running" };
fs.mkdirSync("data/property", { recursive: true });
var ids = input.join(",");
var save = () => fs.writeFileSync(file, JSON.stringify({ ...run, updatedAt: (/* @__PURE__ */ new Date()).toISOString() }, null, 2) + "\n");
for (let batch = 0; batch < 4; batch++) {
  const started = Date.now(), result = spawnSync(process.execPath, [script], { stdio: "inherit", env: { ...process.env, PROPERTY_PROJECT_IDS: ids } });
  let summary;
  try {
    summary = JSON.parse(fs.readFileSync("data/property/index.json", "utf8"));
  } catch {
  }
  if (!summary?.checkedAt || Date.parse(summary.checkedAt) < started - 1e3) {
    run.status = "failed";
    run.reason = "collector_did_not_save_a_current_summary";
    process.exitCode = 1;
    break;
  }
  run.batches.push(summary);
  save();
  if (result.status === 0) {
    run.status = "finished";
    break;
  }
  const next = propertyBatchContinuation(summary);
  if (!next?.length) {
    run.status = "stopped";
    run.reason = summary.stopReason || "collection_error";
    process.exitCode = 1;
    break;
  }
  if (batch === 3) {
    run.status = "stopped";
    run.reason = "batch_limit";
    run.pending = next;
    process.exitCode = 1;
    break;
  }
  ids = next.join(",");
  console.log(JSON.stringify({ collection: "continue_remaining_projects", batch: batch + 2, pending: next.length, reason: "local_request_budget" }));
}
var latest = new Map(run.batches.flatMap((b) => (b.results || []).map((r) => [r.id, r])));
run.attempted = latest.size;
run.apiRequests = run.batches.reduce((n, b) => n + (b.requests?.attempts || 0), 0);
run.results = [...latest.values()];
run.pending ??= scope.filter((id) => !latest.has(id));
save();
console.log(JSON.stringify({ collection: "batch_summary", status: run.status, scope: run.scopeCount, attempted: run.attempted, pending: run.pending.length, apiRequests: run.apiRequests, reason: run.reason }));

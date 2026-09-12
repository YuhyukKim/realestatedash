import test from "node:test";
import assert from "node:assert/strict";
import {parseFavoriteIds, toggleId, FAVORITES_LIMIT, COMPARE_LIMIT} from "../lib/shortlist.mjs";
test("favorite storage rejects invalid data and deduplicates bounded IDs",()=>{
  for(const v of [null, "bad-json", "{}", '"text"', "x".repeat(40001)]) assert.deepEqual(parseFavoriteIds(v),[]);
  assert.deepEqual(parseFavoriteIds(JSON.stringify(["kapt:1","kapt:1",null,4,""," bad ",{},"reb:2"])),["kapt:1","reb:2"]);
  assert.equal(parseFavoriteIds(JSON.stringify(Array.from({length:220},(_,i)=>"id:"+i))).length,FAVORITES_LIMIT);
});
test("comparison is bounded at three; removing remains possible at capacity",()=>{
  const full=["one","two","three"];
  assert.equal(toggleId(full,"four",COMPARE_LIMIT), full);
  assert.deepEqual(toggleId(full,"two",COMPARE_LIMIT),["one","three"]);
  assert.deepEqual(toggleId(["one"],"two",COMPARE_LIMIT),["one","two"]);
  assert.deepEqual(full,["one","two","three"]);
});

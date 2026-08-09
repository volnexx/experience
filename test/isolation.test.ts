import assert from "node:assert/strict";
import test from "node:test";
import { ignoreFilterForFolder, sanitizeIsolationState } from "../src/isolation-state";

test("builds a conventional Obsidian ignore filter for the folder", () => {
  assert.equal(ignoreFilterForFolder(" опыт "), "опыт/");
  assert.equal(ignoreFilterForFolder("архив/опыт"), "архив/опыт/");
});

test("sanitizes missing isolation state", () => {
  assert.deepEqual(sanitizeIsolationState(undefined), {
    coreFolder: "",
    coreFilterManaged: false,
    virtualLinkerFolder: "",
    virtualLinkerMatchesManaged: false,
    virtualLinkerSourcesManaged: false,
  });
});

test("preserves valid isolation state", () => {
  assert.deepEqual(sanitizeIsolationState({
    coreFolder: "опыт",
    coreFilterManaged: true,
    virtualLinkerFolder: "опыт",
    virtualLinkerMatchesManaged: true,
    virtualLinkerSourcesManaged: true,
  }), {
    coreFolder: "опыт",
    coreFilterManaged: true,
    virtualLinkerFolder: "опыт",
    virtualLinkerMatchesManaged: true,
    virtualLinkerSourcesManaged: true,
  });
});

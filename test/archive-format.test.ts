import assert from "node:assert/strict";
import test from "node:test";
import {
  appendGhostLinesContent,
  createExperienceFileName,
  parseStoredExperience,
  recordsEqual,
  serializeStoredExperience,
  type StoredExperience,
} from "../src/archive-format";

test("round-trips a Russian Markdown note without changing content", () => {
  const value: StoredExperience = {
    archivedAt: 1_786_326_000_000,
    archivedPath: ".obsidian/experience-archive/test.experience",
    content: "# Теория деятельности\n\n$$a^2+b^2=c^2$$\n",
    migratedFromPath: "опыт/Теория деятельности.md",
    originalPath: "Заметки/Теория деятельности.md",
    title: "Теория деятельности",
  };
  const parsed = parseStoredExperience(serializeStoredExperience(value), value.archivedPath);
  assert.ok(recordsEqual(value, parsed));
});

test("rejects a corrupted archive payload", () => {
  assert.throws(
    () => parseStoredExperience("{broken", ".obsidian/experience-archive/test.experience"),
    /повреждённый JSON/u,
  );
});

test("rejects an unsupported archive version", () => {
  assert.throws(
    () => parseStoredExperience(JSON.stringify({ version: 99 }), "test.experience"),
    /не поддерживается/u,
  );
});

test("round-trips a ghost note with deleted lines", () => {
  const value: StoredExperience = {
    archivedAt: 1_786_326_000_000,
    archivedPath: ".obsidian/experience-archive/ghost.experience",
    content: "еда – купить яблоки\n",
    kind: "ghost",
    originalPath: "Мысли.md",
    title: "Мысли",
  };
  const parsed = parseStoredExperience(serializeStoredExperience(value), value.archivedPath);
  assert.ok(recordsEqual(value, parsed));
  assert.equal(parsed.kind, "ghost");
});

test("appends deleted lines to one ghost note without joining them", () => {
  assert.equal(
    appendGhostLinesContent("первая строка\n", ["вторая строка", "третья строка"]),
    "первая строка\nвторая строка\nтретья строка\n",
  );
  assert.equal(appendGhostLinesContent("первая строка", ["вторая строка"]), "первая строка\nвторая строка\n");
});

test("creates a deterministic non-Markdown service file name", () => {
  const fileName = createExperienceFileName(1_000, 0.5);
  assert.match(fileName, /^rs-[a-z0-9]+\.experience$/u);
  assert.ok(!fileName.endsWith(".md"));
});

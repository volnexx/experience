import assert from "node:assert/strict";
import test from "node:test";
import { ExperienceTitleIndex } from "../src/index";

test("indexes hidden archive records without reading Vault Markdown files", () => {
  const index = new ExperienceTitleIndex();
  index.rebuild([{
    archivedAt: 100,
    archivedPath: ".obsidian/experience-archive/one.experience",
    originalPath: "Заметки/Теория деятельности.md",
    title: "Теория деятельности",
  }], 0.9);
  const [match] = index.findMatches("Объясни теорию деятельности.");
  assert.equal(match?.path, ".obsidian/experience-archive/one.experience");
});

test("uses the newest record when archived titles are equal", () => {
  const index = new ExperienceTitleIndex();
  index.rebuild([
    {
      archivedAt: 100,
      archivedPath: ".obsidian/experience-archive/old.experience",
      originalPath: "old.md",
      title: "Повтор",
    },
    {
      archivedAt: 200,
      archivedPath: ".obsidian/experience-archive/new.experience",
      originalPath: "new.md",
      title: "Повтор",
    },
  ], 0.9);
  assert.equal(index.findMatches("повтор")[0]?.path, ".obsidian/experience-archive/new.experience");
  assert.equal(index.size, 1);
});

test("does not turn a live note's ghost copy into an archive title link", () => {
  const index = new ExperienceTitleIndex();
  index.rebuild([{
    archivedAt: 300,
    archivedPath: ".obsidian/experience-archive/ghost.experience",
    kind: "ghost",
    originalPath: "Живые/Мысли.md",
    title: "Мысли",
  }], 0.9);
  assert.deepEqual(index.findMatches("Мои мысли"), []);
  assert.equal(index.size, 0);
});

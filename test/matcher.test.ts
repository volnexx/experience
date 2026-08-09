import assert from "node:assert/strict";
import test from "node:test";
import { FuzzyTitleMatcher, normalizeForMatching, similarity } from "../src/matcher";

test("normalizes Russian case, ё and separators", () => {
  assert.equal(normalizeForMatching("  ТЁМНАЯ—МАТЕРИЯ "), "темная материя");
});

test("finds an exact multiword title", () => {
  const matcher = new FuzzyTitleMatcher(["Теория деятельности"], 0.9);
  const [match] = matcher.findMatches("Здесь теория деятельности объясняет поступок.");
  assert.equal(match?.title, "Теория деятельности");
  assert.equal("Здесь теория деятельности объясняет поступок.".slice(match?.from, match?.to), "теория деятельности");
});

test("finds a phrase with one missing letter at 90 percent", () => {
  const matcher = new FuzzyTitleMatcher(["Теория деятельности"], 0.9);
  const [match] = matcher.findMatches("Это теория деятелности человека.");
  assert.equal(match?.title, "Теория деятельности");
  assert.ok((match?.score ?? 0) >= 0.9);
});

test("rejects a phrase below the threshold", () => {
  const matcher = new FuzzyTitleMatcher(["Теория деятельности"], 0.9);
  assert.deepEqual(matcher.findMatches("Это теория сознания человека."), []);
});

test("does not match a phrase across line boundaries", () => {
  const matcher = new FuzzyTitleMatcher(["Теория деятельности"], 0.9);
  assert.deepEqual(matcher.findMatches("Теория\nдеятельности"), []);
});

test("prefers the longer exact title when matches overlap", () => {
  const matcher = new FuzzyTitleMatcher(["теория", "теория деятельности"], 0.9);
  const matches = matcher.findMatches("теория деятельности");
  assert.equal(matches.length, 1);
  assert.equal(matches[0]?.title, "теория деятельности");
});

test("calculates edit similarity", () => {
  assert.equal(similarity("опыт", "опыт"), 1);
  assert.equal(similarity("abcd", "abce"), 0.75);
});

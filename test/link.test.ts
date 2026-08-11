import assert from "node:assert/strict";
import test from "node:test";
import {
  createExperienceLinkDescriptor,
  isExcludedSyntaxNodeName,
  shouldOpenExperienceInNewLeaf,
} from "../src/link";

test("creates a real internal anchor recognized by Jump to Link", () => {
  const path = ".obsidian/experience-archive/one.experience";
  const descriptor = createExperienceLinkDescriptor(path, "Теория деятельности");

  assert.equal(descriptor.tagName, "a");
  assert.match(descriptor.className, /(?:^|\s)internal-link(?:\s|$)/u);
  assert.equal(descriptor.attributes["data-href"], path);
  assert.equal(descriptor.attributes["data-experience-path"], path);
  assert.match(descriptor.attributes.href ?? "", /^#experience-/u);
});

test("does not exclude Markdown heading syntax from experience links", () => {
  assert.equal(isExcludedSyntaxNodeName("HyperMD-header_HyperMD-header-2"), false);
  assert.equal(isExcludedSyntaxNodeName("HeaderMark"), false);
  assert.equal(isExcludedSyntaxNodeName("URL"), true);
  assert.equal(isExcludedSyntaxNodeName("InlineCode"), true);
});

test("opens modifier clicks and the middle mouse button in a new leaf", () => {
  assert.equal(shouldOpenExperienceInNewLeaf({ button: 0, ctrlKey: false, metaKey: false }), false);
  assert.equal(shouldOpenExperienceInNewLeaf({ button: 0, ctrlKey: true, metaKey: false }), true);
  assert.equal(shouldOpenExperienceInNewLeaf({ button: 0, ctrlKey: false, metaKey: true }), true);
  assert.equal(shouldOpenExperienceInNewLeaf({ button: 1, ctrlKey: false, metaKey: false }), true);
});

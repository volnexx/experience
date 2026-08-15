import assert from "node:assert/strict";
import test from "node:test";
import {
  createExperienceLinkDescriptor,
  createExperienceLinkElement,
  isCursorInsideExperienceMatch,
  isExcludedSyntaxNodeName,
  shouldOpenExperienceInNewLeaf,
} from "../src/link";

test("the real anchor directly opens its hidden archive entry", () => {
  const attributes = new Map<string, string>();
  const listeners = new Map<string, EventListener>();
  const anchor = {
    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      assert.equal(typeof listener, "function");
      listeners.set(type, listener as EventListener);
    },
    className: "",
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    textContent: "",
  } as unknown as HTMLAnchorElement;
  const previousDocument = globalThis.document;
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: { createElement: () => anchor },
  });

  const calls: Array<{ newLeaf: boolean; path: string }> = [];
  try {
    const link = createExperienceLinkElement(
      ".obsidian/experience-archive/one.experience",
      "Теория деятельности",
      "теория деятельности",
      async (path, newLeaf) => {
        calls.push({ newLeaf, path });
      },
    );
    const stopped = { immediate: false, normal: false, prevented: false };
    listeners.get("click")?.({
      button: 0,
      ctrlKey: false,
      metaKey: false,
      preventDefault: () => { stopped.prevented = true; },
      stopImmediatePropagation: () => { stopped.immediate = true; },
      stopPropagation: () => { stopped.normal = true; },
    } as unknown as Event);

    assert.equal(link, anchor);
    assert.equal(anchor.className, "experience-title-match internal-link");
    assert.equal(anchor.textContent, "теория деятельности");
    assert.equal(attributes.get("data-href"), ".obsidian/experience-archive/one.experience");
    assert.deepEqual(calls, [{
      newLeaf: false,
      path: ".obsidian/experience-archive/one.experience",
    }]);
    assert.deepEqual(stopped, { immediate: true, normal: true, prevented: true });
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: previousDocument,
    });
  }
});

test("creates a real internal anchor recognized by Jump to Link", () => {
  const path = ".obsidian/experience-archive/one.experience";
  const descriptor = createExperienceLinkDescriptor(path, "Теория деятельности");

  assert.equal(descriptor.tagName, "a");
  assert.match(descriptor.className, /(?:^|\s)internal-link(?:\s|$)/u);
  assert.equal(descriptor.attributes["data-href"], path);
  assert.equal(descriptor.attributes["data-experience-path"], path);
  assert.match(descriptor.attributes.href ?? "", /^#experience-/u);
  assert.equal(descriptor.attributes.target, "_blank");
  assert.equal(descriptor.attributes.rel, "noopener noreferrer");
});

test("keeps the match editable only while the cursor is inside it", () => {
  assert.equal(isCursorInsideExperienceMatch(9, 10, 20), false);
  assert.equal(isCursorInsideExperienceMatch(10, 10, 20), true);
  assert.equal(isCursorInsideExperienceMatch(15, 10, 20), true);
  assert.equal(isCursorInsideExperienceMatch(20, 10, 20), true);
  assert.equal(isCursorInsideExperienceMatch(21, 10, 20), false);
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

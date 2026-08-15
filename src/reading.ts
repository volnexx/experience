import { ExperienceTitleIndex } from "./index";
import { createExperienceLinkElement } from "./link";

const EXCLUDED_SELECTOR = [
  "a",
  "code",
  "pre",
  "script",
  "style",
  "textarea",
  ".experience-title-match",
  ".frontmatter",
  ".metadata-container",
  ".math",
].join(",");

export function highlightExperienceTitles(
  root: HTMLElement,
  index: ExperienceTitleIndex,
  openExperience: (path: string, newLeaf: boolean) => Promise<void>,
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null;

  while ((current = walker.nextNode())) {
    if (!(current instanceof Text) || !current.textContent?.trim()) continue;
    if (current.parentElement?.closest(EXCLUDED_SELECTOR)) continue;
    nodes.push(current);
  }

  for (const node of nodes) highlightTextNode(node, index, openExperience);
}

function highlightTextNode(
  node: Text,
  index: ExperienceTitleIndex,
  openExperience: (path: string, newLeaf: boolean) => Promise<void>,
): void {
  const text = node.textContent ?? "";
  const matches = index.findMatches(text);
  if (!matches.length) return;

  const fragment = document.createDocumentFragment();
  let position = 0;
  for (const match of matches) {
    if (position < match.from) fragment.append(text.slice(position, match.from));
    const link = createExperienceLinkElement(
      match.path,
      match.title,
      text.slice(match.from, match.to),
      openExperience,
    );
    fragment.append(link);
    position = match.to;
  }
  if (position < text.length) fragment.append(text.slice(position));
  node.replaceWith(fragment);
}

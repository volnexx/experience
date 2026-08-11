import { ExperienceTitleIndex } from "./index";
import { createExperienceLinkDescriptor, shouldOpenExperienceInNewLeaf } from "./link";

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
    const descriptor = createExperienceLinkDescriptor(match.path, match.title);
    const link = document.createElement(descriptor.tagName);
    link.className = descriptor.className;
    for (const [name, value] of Object.entries(descriptor.attributes)) link.setAttribute(name, value);
    link.textContent = text.slice(match.from, match.to);
    const activate = (event: MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();
      void openExperience(match.path, shouldOpenExperienceInNewLeaf(event));
    };
    link.addEventListener("click", activate);
    link.addEventListener("auxclick", (event) => {
      if (event.button === 1) activate(event);
    });
    fragment.append(link);
    position = match.to;
  }
  if (position < text.length) fragment.append(text.slice(position));
  node.replaceWith(fragment);
}

import { type App } from "obsidian";
import { ExperienceTitleIndex } from "./index";

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
  app: App,
  sourcePath: string,
): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let current: Node | null;

  while ((current = walker.nextNode())) {
    if (!(current instanceof Text) || !current.textContent?.trim()) continue;
    if (current.parentElement?.closest(EXCLUDED_SELECTOR)) continue;
    nodes.push(current);
  }

  for (const node of nodes) highlightTextNode(node, index, app, sourcePath);
}

function highlightTextNode(node: Text, index: ExperienceTitleIndex, app: App, sourcePath: string): void {
  const text = node.textContent ?? "";
  const matches = index.findMatches(text);
  if (!matches.length) return;

  const fragment = document.createDocumentFragment();
  let position = 0;
  for (const match of matches) {
    if (position < match.from) fragment.append(text.slice(position, match.from));
    const link = document.createElement("a");
    link.className = "experience-title-match internal-link";
    link.dataset.experiencePath = match.path;
    link.dataset.href = match.path;
    link.href = match.path;
    link.ariaLabel = `Открыть заметку «${match.title}»`;
    link.textContent = text.slice(match.from, match.to);
    link.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const newLeaf = event.ctrlKey || event.metaKey;
      const file = app.vault.getFileByPath(match.path);
      if (file) void app.workspace.getLeaf(newLeaf).openFile(file);
      else void app.workspace.openLinkText(match.path, sourcePath, newLeaf);
    });
    fragment.append(link);
    position = match.to;
  }
  if (position < text.length) fragment.append(text.slice(position));
  node.replaceWith(fragment);
}

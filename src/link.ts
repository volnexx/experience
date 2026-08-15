export interface ExperienceLinkDescriptor {
  attributes: Record<string, string>;
  className: string;
  tagName: "a";
}

export interface ExperienceLinkActivation {
  button: number;
  ctrlKey: boolean;
  metaKey: boolean;
}

export type ExperienceLinkOpener = (path: string, newLeaf: boolean) => Promise<void>;

export const EXPERIENCE_LINK_SELECTOR = "a.experience-title-match.internal-link[data-experience-path][data-href]";

export function createExperienceLinkDescriptor(path: string, title: string): ExperienceLinkDescriptor {
  return {
    attributes: {
      "aria-label": `Открыть заметку «${title}»`,
      "data-experience-path": path,
      "data-href": path,
      href: `#experience-${encodeURIComponent(path)}`,
      rel: "noopener noreferrer",
      target: "_blank",
    },
    className: "experience-title-match internal-link",
    tagName: "a",
  };
}

export function createExperienceLinkElement(
  path: string,
  title: string,
  text: string,
  openExperience: ExperienceLinkOpener,
): HTMLAnchorElement {
  const descriptor = createExperienceLinkDescriptor(path, title);
  const link = document.createElement(descriptor.tagName);
  link.className = descriptor.className;
  for (const [name, value] of Object.entries(descriptor.attributes)) link.setAttribute(name, value);
  link.textContent = text;

  const activate = (event: MouseEvent): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
    event.stopPropagation();
    void openExperience(path, shouldOpenExperienceInNewLeaf(event));
  };
  link.addEventListener("click", activate);
  link.addEventListener("auxclick", (event) => {
    if (event.button === 1) activate(event);
  });
  return link;
}

export function shouldOpenExperienceInNewLeaf(event: ExperienceLinkActivation): boolean {
  return event.button === 1 || event.ctrlKey || event.metaKey;
}

export function isCursorInsideExperienceMatch(cursor: number, from: number, to: number): boolean {
  return cursor >= from && cursor <= to;
}

export function isExcludedSyntaxNodeName(name: string): boolean {
  const normalized = name.toLocaleLowerCase();
  return ["code", "link", "url", "hashtag", "frontmatter", "metadata", "htmlblock"]
    .some((fragment) => normalized.includes(fragment));
}

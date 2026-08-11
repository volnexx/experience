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

export const EXPERIENCE_LINK_SELECTOR = "a.experience-title-match.internal-link[data-experience-path][data-href]";

export function createExperienceLinkDescriptor(path: string, title: string): ExperienceLinkDescriptor {
  return {
    attributes: {
      "aria-label": `Открыть заметку «${title}»`,
      "data-experience-path": path,
      "data-href": path,
      href: `#experience-${encodeURIComponent(path)}`,
    },
    className: "experience-title-match internal-link",
    tagName: "a",
  };
}

export function shouldOpenExperienceInNewLeaf(event: ExperienceLinkActivation): boolean {
  return event.button === 1 || event.ctrlKey || event.metaKey;
}

export function isExcludedSyntaxNodeName(name: string): boolean {
  const normalized = name.toLocaleLowerCase();
  return ["code", "link", "url", "hashtag", "frontmatter", "metadata", "htmlblock"]
    .some((fragment) => normalized.includes(fragment));
}

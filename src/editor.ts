import { syntaxTree } from "@codemirror/language";
import { StateEffect, type Extension } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { ExperienceTitleIndex } from "./index";

interface Interval {
  from: number;
  to: number;
}

const refreshEffect = StateEffect.define<null>();
const EXPERIENCE_LINK_SELECTOR = "a.experience-title-match[data-experience-path]";

export class EditorRefreshBus {
  private readonly callbacks = new Set<() => void>();

  subscribe(callback: () => void): () => void {
    this.callbacks.add(callback);
    return () => this.callbacks.delete(callback);
  }

  refresh(): void {
    for (const callback of this.callbacks) callback();
  }
}

export function createExperienceEditorExtension(
  index: ExperienceTitleIndex,
  refreshBus: EditorRefreshBus,
  openExperience: (path: string, newLeaf: boolean) => Promise<void>,
): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    private readonly unsubscribe: () => void;

    constructor(private readonly view: EditorView) {
      this.decorations = buildDecorations(view, index);
      this.unsubscribe = refreshBus.subscribe(() => {
        this.view.dispatch({ effects: refreshEffect.of(null) });
      });
    }

    update(update: ViewUpdate): void {
      const forced = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshEffect)),
      );
      if (forced || update.docChanged || update.viewportChanged) {
        this.decorations = buildDecorations(update.view, index);
      }
    }

    destroy(): void {
      this.unsubscribe();
    }
  }, {
    decorations: (value) => value.decorations,
    eventHandlers: {
      click(event) {
        const link = findExperienceLink(event.target);
        if (!link) return false;
        const path = link.dataset.experiencePath;
        if (!path) return false;

        event.preventDefault();
        event.stopPropagation();
        void openExperience(path, event.ctrlKey || event.metaKey);
        return true;
      },
    },
  });
}

function buildDecorations(view: EditorView, index: ExperienceTitleIndex): DecorationSet {
  const ranges = expandedVisibleRanges(view);
  const decorations: Array<{ from: number; path: string; title: string; to: number }> = [];

  for (const range of ranges) {
    const text = view.state.doc.sliceString(range.from, range.to);
    const excluded = excludedIntervals(view, range.from, range.to);
    for (const match of index.findMatches(text, range.from)) {
      if (excluded.some((interval) => interval.from < match.to && match.from < interval.to)) continue;
      decorations.push({ from: match.from, path: match.path, title: match.title, to: match.to });
    }
  }

  decorations.sort((left, right) => left.from - right.from || left.to - right.to);
  return Decoration.set(decorations.map(({ from, path, title, to }) => Decoration.mark({
    attributes: {
      "aria-label": `Открыть заметку «${title}»`,
      "data-experience-path": path,
      "data-href": path,
      href: `#experience-${encodeURIComponent(path)}`,
    },
    class: "experience-title-match internal-link",
    tagName: "a",
  }).range(from, to)), true);
}

function findExperienceLink(target: EventTarget | null): HTMLAnchorElement | null {
  return target instanceof Element ? target.closest<HTMLAnchorElement>(EXPERIENCE_LINK_SELECTOR) : null;
}

function expandedVisibleRanges(view: EditorView): Interval[] {
  const expanded = view.visibleRanges.map(({ from, to }) => ({
    from: view.state.doc.lineAt(from).from,
    to: view.state.doc.lineAt(to).to,
  }));
  const merged: Interval[] = [];

  for (const range of expanded) {
    const previous = merged[merged.length - 1];
    if (previous && range.from <= previous.to) previous.to = Math.max(previous.to, range.to);
    else merged.push({ ...range });
  }
  return merged;
}

function excludedIntervals(view: EditorView, from: number, to: number): Interval[] {
  const excluded: Interval[] = [];
  const fragments = ["code", "link", "url", "hashtag", "frontmatter", "metadata", "htmlblock"];

  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      const name = node.type.name.toLocaleLowerCase();
      if (fragments.some((fragment) => name.includes(fragment))) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
      return undefined;
    },
  });
  return excluded;
}

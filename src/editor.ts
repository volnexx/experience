import { syntaxTree } from "@codemirror/language";
import { StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { ExperienceTitleIndex } from "./index";
import {
  createExperienceLinkElement,
  isCursorInsideExperienceMatch,
  isExcludedSyntaxNodeName,
  type ExperienceLinkOpener,
} from "./link";

interface Interval {
  from: number;
  to: number;
}

const refreshEffect = StateEffect.define<null>();

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
      this.decorations = buildDecorations(view, index, openExperience);
      this.unsubscribe = refreshBus.subscribe(() => {
        this.view.dispatch({ effects: refreshEffect.of(null) });
      });
    }

    update(update: ViewUpdate): void {
      const forced = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => effect.is(refreshEffect)),
      );
      if (forced || update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view, index, openExperience);
      }
    }

    destroy(): void {
      this.unsubscribe();
    }
  }, { decorations: (value) => value.decorations });
}

class ExperienceLinkWidget extends WidgetType {
  constructor(
    private readonly path: string,
    private readonly title: string,
    private readonly text: string,
    private readonly openExperience: ExperienceLinkOpener,
  ) {
    super();
  }

  eq(other: WidgetType): boolean {
    return other instanceof ExperienceLinkWidget
      && this.path === other.path
      && this.title === other.title
      && this.text === other.text;
  }

  toDOM(): HTMLElement {
    return createExperienceLinkElement(this.path, this.title, this.text, this.openExperience);
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(
  view: EditorView,
  index: ExperienceTitleIndex,
  openExperience: ExperienceLinkOpener,
): DecorationSet {
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
  const cursor = view.state.selection.main.head;
  return Decoration.set(decorations.map(({ from, path, title, to }) => {
    if (isCursorInsideExperienceMatch(cursor, from, to)) {
      return Decoration.mark({ class: "experience-title-match experience-title-match-editing" }).range(from, to);
    }
    const text = view.state.doc.sliceString(from, to);
    return Decoration.replace({
      widget: new ExperienceLinkWidget(path, title, text, openExperience),
    }).range(from, to);
  }), true);
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
  syntaxTree(view.state).iterate({
    from,
    to,
    enter(node) {
      if (isExcludedSyntaxNodeName(node.type.name)) {
        excluded.push({ from: node.from, to: node.to });
        return false;
      }
      return undefined;
    },
  });
  return excluded;
}

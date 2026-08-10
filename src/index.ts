import { type ExperienceRecord } from "./archive-format";
import { FuzzyTitleMatcher, normalizeForMatching, type TextMatch } from "./matcher";

export interface ExperienceTextMatch extends TextMatch {
  path: string;
}

interface IndexedTitle {
  archivedAt: number;
  path: string;
  title: string;
}

export class ExperienceTitleIndex {
  private matcher = new FuzzyTitleMatcher([], 0.9);
  private pathByTitle = new Map<string, string>();
  private titleCount = 0;

  rebuild(records: ExperienceRecord[], threshold: number): void {
    const indexedTitles: IndexedTitle[] = records.map((record) => ({
      archivedAt: record.archivedAt,
      path: record.archivedPath,
      title: record.title,
    }));

    indexedTitles.sort((left, right) => right.archivedAt - left.archivedAt || left.path.localeCompare(right.path));
    this.pathByTitle = new Map();
    const titles: string[] = [];
    for (const item of indexedTitles) {
      const normalizedTitle = normalizeForMatching(item.title);
      if (!normalizedTitle || this.pathByTitle.has(normalizedTitle)) continue;
      this.pathByTitle.set(normalizedTitle, item.path);
      titles.push(item.title);
    }

    this.titleCount = titles.length;
    this.matcher = new FuzzyTitleMatcher(titles, threshold);
  }

  findMatches(text: string, baseOffset = 0): ExperienceTextMatch[] {
    return this.matcher.findMatches(text, baseOffset).flatMap((match) => {
      const path = this.pathByTitle.get(normalizeForMatching(match.title));
      return path ? [{ ...match, path }] : [];
    });
  }

  get size(): number {
    return this.titleCount;
  }
}

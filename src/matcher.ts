export interface TextMatch {
  from: number;
  score: number;
  title: string;
  to: number;
}

interface TitleEntry {
  normalized: string;
  title: string;
}

interface WordToken {
  from: number;
  normalized: string;
  to: number;
}

const WORD_PATTERN = /[\p{L}\p{N}]+/gu;
const LINE_PATTERN = /[^\r\n]+/g;

export function normalizeForMatching(value: string): string {
  const words = value.normalize("NFKC").match(WORD_PATTERN) ?? [];
  return words.map(normalizeWord).filter(Boolean).join(" ");
}

export function similarity(left: string, right: string): number {
  if (left === right) return 1;
  const maximum = Math.max(left.length, right.length);
  if (maximum === 0) return 1;
  return 1 - levenshtein(left, right) / maximum;
}

export class FuzzyTitleMatcher {
  private readonly buckets = new Map<number, Map<number, TitleEntry[]>>();
  private readonly wordCounts: number[];
  readonly threshold: number;

  constructor(titles: Iterable<string>, threshold = 0.9) {
    this.threshold = clamp(threshold, 0.5, 1);
    const seen = new Set<string>();

    for (const rawTitle of titles) {
      const title = rawTitle.trim();
      const normalized = normalizeForMatching(title);
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);

      const wordCount = normalized.split(" ").length;
      let lengths = this.buckets.get(wordCount);
      if (!lengths) {
        lengths = new Map();
        this.buckets.set(wordCount, lengths);
      }
      const entries = lengths.get(normalized.length) ?? [];
      entries.push({ normalized, title });
      lengths.set(normalized.length, entries);
    }

    this.wordCounts = [...this.buckets.keys()].sort((a, b) => a - b);
  }

  findMatches(text: string, baseOffset = 0): TextMatch[] {
    if (!text || this.wordCounts.length === 0) return [];
    const candidates: TextMatch[] = [];

    for (const lineResult of text.matchAll(LINE_PATTERN)) {
      const line = lineResult[0];
      const lineOffset = baseOffset + (lineResult.index ?? 0);
      const tokens = tokenize(line, lineOffset);

      for (const wordCount of this.wordCounts) {
        if (wordCount > tokens.length) break;
        const lengths = this.buckets.get(wordCount);
        if (!lengths) continue;

        for (let start = 0; start + wordCount <= tokens.length; start++) {
          const window = tokens.slice(start, start + wordCount);
          const first = window[0];
          const last = window[window.length - 1];
          if (!first || !last) continue;

          const phrase = window.map((token) => token.normalized).join(" ");
          const minimumLength = Math.ceil(phrase.length * this.threshold);
          const maximumLength = Math.floor(phrase.length / this.threshold);

          for (let length = minimumLength; length <= maximumLength; length++) {
            const entries = lengths.get(length);
            if (!entries) continue;

            for (const entry of entries) {
              const maximum = Math.max(phrase.length, entry.normalized.length);
              const allowedDistance = Math.floor((1 - this.threshold) * maximum + 1e-9);
              const distance = boundedLevenshtein(phrase, entry.normalized, allowedDistance);
              if (distance > allowedDistance) continue;

              const score = maximum === 0 ? 1 : 1 - distance / maximum;
              if (score + Number.EPSILON < this.threshold) continue;
              candidates.push({ from: first.from, score, title: entry.title, to: last.to });
            }
          }
        }
      }
    }

    return selectNonOverlapping(candidates);
  }
}

function normalizeWord(value: string): string {
  return value.toLocaleLowerCase("ru-RU").replaceAll("ё", "е");
}

function tokenize(line: string, lineOffset: number): WordToken[] {
  const tokens: WordToken[] = [];
  for (const result of line.matchAll(WORD_PATTERN)) {
    const value = result[0];
    const index = result.index ?? 0;
    tokens.push({
      from: lineOffset + index,
      normalized: normalizeWord(value),
      to: lineOffset + index + value.length,
    });
  }
  return tokens;
}

function selectNonOverlapping(matches: TextMatch[]): TextMatch[] {
  const preferred = [...matches].sort((left, right) =>
    right.score - left.score
      || (right.to - right.from) - (left.to - left.from)
      || left.from - right.from,
  );
  const selected: TextMatch[] = [];

  for (const match of preferred) {
    if (selected.some((current) => current.from < match.to && match.from < current.to)) continue;
    selected.push(match);
  }
  return selected.sort((left, right) => left.from - right.from || left.to - right.to);
}

function boundedLevenshtein(left: string, right: string, limit: number): number {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > limit) return limit + 1;
  if (left.length > right.length) return boundedLevenshtein(right, left, limit);

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex++) {
    const current = new Array<number>(right.length + 1);
    current[0] = leftIndex;
    let rowMinimum = current[0];
    const leftCharacter = left[leftIndex - 1];

    for (let rightIndex = 1; rightIndex <= right.length; rightIndex++) {
      const substitution = previous[rightIndex - 1]! + (leftCharacter === right[rightIndex - 1] ? 0 : 1);
      const insertion = current[rightIndex - 1]! + 1;
      const deletion = previous[rightIndex]! + 1;
      const value = Math.min(substitution, insertion, deletion);
      current[rightIndex] = value;
      rowMinimum = Math.min(rowMinimum, value);
    }

    if (rowMinimum > limit) return limit + 1;
    previous = current;
  }
  return previous[right.length] ?? limit + 1;
}

function levenshtein(left: string, right: string): number {
  return boundedLevenshtein(left, right, Math.max(left.length, right.length));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

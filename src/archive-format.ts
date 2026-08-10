export const EXPERIENCE_ARCHIVE_VERSION = 1;
export const EXPERIENCE_FILE_EXTENSION = ".experience";

export interface ExperienceRecord {
  archivedAt: number;
  archivedPath: string;
  migratedFromPath?: string;
  originalPath: string;
  title: string;
}

export interface StoredExperience extends ExperienceRecord {
  content: string;
}

interface StoredExperiencePayload {
  archivedAt: number;
  content: string;
  migratedFromPath?: string;
  originalPath: string;
  title: string;
  version: number;
}

export function serializeStoredExperience(value: StoredExperience): string {
  const payload: StoredExperiencePayload = {
    archivedAt: value.archivedAt,
    content: value.content,
    originalPath: value.originalPath,
    title: value.title,
    version: EXPERIENCE_ARCHIVE_VERSION,
  };
  if (value.migratedFromPath) payload.migratedFromPath = value.migratedFromPath;
  return JSON.stringify(payload);
}

export function parseStoredExperience(raw: string, archivedPath: string): StoredExperience {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("Служебный файл опыта содержит повреждённый JSON.");
  }
  if (!isRecord(value) || value.version !== EXPERIENCE_ARCHIVE_VERSION) {
    throw new Error("Версия служебного файла опыта не поддерживается.");
  }
  if (typeof value.archivedAt !== "number" || !Number.isFinite(value.archivedAt)) {
    throw new Error("В служебном файле опыта отсутствует время удаления.");
  }
  if (typeof value.title !== "string" || !value.title.trim()) {
    throw new Error("В служебном файле опыта отсутствует название.");
  }
  if (typeof value.originalPath !== "string" || !value.originalPath) {
    throw new Error("В служебном файле опыта отсутствует исходный путь.");
  }
  if (typeof value.content !== "string") {
    throw new Error("В служебном файле опыта отсутствует содержимое заметки.");
  }
  const stored: StoredExperience = {
    archivedAt: value.archivedAt,
    archivedPath,
    content: value.content,
    originalPath: value.originalPath,
    title: value.title.trim(),
  };
  if (typeof value.migratedFromPath === "string" && value.migratedFromPath) {
    stored.migratedFromPath = value.migratedFromPath;
  }
  return stored;
}

export function recordsEqual(left: StoredExperience, right: StoredExperience): boolean {
  return left.archivedAt === right.archivedAt
    && left.archivedPath === right.archivedPath
    && left.content === right.content
    && left.migratedFromPath === right.migratedFromPath
    && left.originalPath === right.originalPath
    && left.title === right.title;
}

export function createExperienceFileName(
  now = Date.now(),
  random = Math.random(),
): string {
  const safeRandom = Math.min(1 - Number.EPSILON, Math.max(0, random));
  const randomPart = Math.floor(safeRandom * Number.MAX_SAFE_INTEGER).toString(36).padStart(10, "0");
  return `${now.toString(36)}-${randomPart}${EXPERIENCE_FILE_EXTENSION}`;
}

export function isExperienceRecord(value: unknown): value is ExperienceRecord {
  return isRecord(value)
    && typeof value.archivedAt === "number"
    && Number.isFinite(value.archivedAt)
    && typeof value.archivedPath === "string"
    && !!value.archivedPath
    && (value.migratedFromPath === undefined || typeof value.migratedFromPath === "string")
    && typeof value.originalPath === "string"
    && !!value.originalPath
    && typeof value.title === "string"
    && !!value.title.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

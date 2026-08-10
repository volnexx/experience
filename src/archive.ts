import { around } from "monkey-around";
import { App, normalizePath, TAbstractFile, TFile, TFolder } from "obsidian";
import {
  createExperienceFileName,
  EXPERIENCE_FILE_EXTENSION,
  parseStoredExperience,
  recordsEqual,
  serializeStoredExperience,
  type ExperienceRecord,
  type StoredExperience,
} from "./archive-format";

export type { ExperienceRecord, StoredExperience } from "./archive-format";

export interface ArchiveInitializationResult {
  errors: string[];
  migratedCount: number;
  records: ExperienceRecord[];
  staleVaultPaths: string[];
}

interface DeletionManager {
  promptForDeletion(file: TAbstractFile): Promise<boolean>;
}

export class ExperienceArchive {
  private operationQueue: Promise<void> = Promise.resolve();
  readonly rootPath: string;

  constructor(
    private readonly app: App,
    private readonly getLegacyFolder: () => string,
  ) {
    this.rootPath = normalizePath(`${app.vault.configDir}/experience-archive`);
  }

  initialize(records: ExperienceRecord[]): Promise<ArchiveInitializationResult> {
    return this.enqueue(() => this.initializeNow(records));
  }

  archive(file: TFile): Promise<ExperienceRecord> {
    return this.enqueue(() => this.archiveNow(file));
  }

  read(archivedPath: string): Promise<StoredExperience> {
    return this.enqueue(() => this.readNow(archivedPath));
  }

  isLegacyPath(path: string): boolean {
    return isPathInFolder(path, normalizePath(this.getLegacyFolder().trim()));
  }

  isStoredPath(path: string): boolean {
    return path.startsWith(`${this.rootPath}/`) && path.endsWith(EXPERIENCE_FILE_EXTENSION);
  }

  private async initializeNow(records: ExperienceRecord[]): Promise<ArchiveInitializationResult> {
    await this.ensureAdapterFolder(this.rootPath);
    const errors: string[] = [];
    const stored = await this.scanStored(errors);
    const legacyRecords = new Map(records
      .filter((record) => !this.isStoredPath(record.archivedPath))
      .map((record) => [record.archivedPath, record]));
    const migratedByPath = new Map(stored
      .filter((entry) => entry.migratedFromPath)
      .map((entry) => [entry.migratedFromPath!, entry]));
    const staleVaultPaths = new Set<string>();
    let migratedCount = 0;

    const legacyFolder = normalizePath(this.getLegacyFolder().trim());
    const legacyFiles = legacyFolder && legacyFolder !== "."
      ? this.app.vault.getMarkdownFiles().filter((file) => isPathInFolder(file.path, legacyFolder))
      : [];

    for (const file of legacyFiles) {
      const previous = legacyRecords.get(file.path);
      try {
        const content = await this.app.vault.read(file);
        const alreadyStored = migratedByPath.get(file.path);
        if (alreadyStored && alreadyStored.content === content) {
          await this.app.vault.delete(file, false);
          staleVaultPaths.add(file.path);
          migratedCount++;
          continue;
        }

        const saved = await this.writeStored({
          archivedAt: previous?.archivedAt ?? file.stat.mtime,
          archivedPath: "",
          content,
          migratedFromPath: file.path,
          originalPath: previous?.originalPath ?? file.path,
          title: previous?.title ?? file.basename,
        });
        try {
          await this.app.vault.delete(file, false);
        } catch (error) {
          await this.removeStoredAfterFailedSourceDelete(saved.archivedPath);
          throw error;
        }
        stored.push(saved);
        migratedByPath.set(file.path, saved);
        staleVaultPaths.add(file.path);
        if (previous?.originalPath) staleVaultPaths.add(previous.originalPath);
        migratedCount++;
      } catch (error) {
        errors.push(`«${file.path}»: ${messageOf(error)}`);
      }
    }

    await this.removeEmptyLegacyFolders(legacyFolder, errors);
    const recordsByPath = new Map<string, ExperienceRecord>();
    for (const entry of stored) recordsByPath.set(entry.archivedPath, recordFromStored(entry));
    return {
      errors,
      migratedCount,
      records: [...recordsByPath.values()].sort((left, right) => right.archivedAt - left.archivedAt),
      staleVaultPaths: [...staleVaultPaths],
    };
  }

  private async archiveNow(file: TFile): Promise<ExperienceRecord> {
    if (file.extension.toLocaleLowerCase() !== "md") {
      throw new Error("В опыт можно отправлять только Markdown-заметки.");
    }
    const stored = await this.writeStored({
      archivedAt: Date.now(),
      archivedPath: "",
      content: await this.app.vault.read(file),
      originalPath: file.path,
      title: file.basename,
    });
    try {
      await this.app.vault.delete(file, false);
    } catch (error) {
      await this.removeStoredAfterFailedSourceDelete(stored.archivedPath);
      throw error;
    }
    return recordFromStored(stored);
  }

  private async writeStored(source: StoredExperience): Promise<StoredExperience> {
    await this.ensureAdapterFolder(this.rootPath);
    let destination = "";
    for (let attempt = 0; attempt < 100; attempt++) {
      const suffix = attempt === 0 ? "" : `-${attempt}`;
      const fileName = createExperienceFileName().replace(EXPERIENCE_FILE_EXTENSION, `${suffix}${EXPERIENCE_FILE_EXTENSION}`);
      const candidate = normalizePath(`${this.rootPath}/${fileName}`);
      if (!await this.app.vault.adapter.exists(candidate)) {
        destination = candidate;
        break;
      }
    }
    if (!destination) throw new Error("Не удалось подобрать свободное имя служебного файла.");

    const stored: StoredExperience = { ...source, archivedPath: destination };
    const serialized = serializeStoredExperience(stored);
    try {
      await this.app.vault.adapter.write(destination, serialized);
      const verified = parseStoredExperience(await this.app.vault.adapter.read(destination), destination);
      if (!recordsEqual(stored, verified)) throw new Error("Проверка записанного содержимого не пройдена.");
      return verified;
    } catch (error) {
      await this.safeRemove(destination);
      throw error;
    }
  }

  private async readNow(archivedPath: string): Promise<StoredExperience> {
    if (!this.isStoredPath(archivedPath)) throw new Error("Недопустимый путь служебного файла.");
    if (!await this.app.vault.adapter.exists(archivedPath)) throw new Error("Архивная заметка не найдена.");
    return parseStoredExperience(await this.app.vault.adapter.read(archivedPath), archivedPath);
  }

  private async scanStored(errors: string[]): Promise<StoredExperience[]> {
    const result: StoredExperience[] = [];
    const listed = await this.app.vault.adapter.list(this.rootPath);
    for (const path of listed.files.sort()) {
      if (!this.isStoredPath(path)) continue;
      try {
        result.push(parseStoredExperience(await this.app.vault.adapter.read(path), path));
      } catch (error) {
        errors.push(`«${path}»: ${messageOf(error)}`);
      }
    }
    return result;
  }

  private async ensureAdapterFolder(path: string): Promise<void> {
    let current = "";
    for (const part of normalizePath(path).split("/")) {
      current = current ? `${current}/${part}` : part;
      const stat = await this.app.vault.adapter.stat(current);
      if (stat?.type === "file") throw new Error(`«${current}» является файлом, а не папкой.`);
      if (!stat) await this.app.vault.adapter.mkdir(current);
    }
  }

  private async removeEmptyLegacyFolders(folder: string, errors: string[]): Promise<void> {
    if (!folder || folder === ".") return;
    const folders = this.app.vault.getAllLoadedFiles()
      .filter((item): item is TFolder => item instanceof TFolder && isPathInFolder(item.path, folder))
      .sort((left, right) => right.path.split("/").length - left.path.split("/").length);
    for (const item of folders) {
      if (item.children.length) continue;
      try {
        await this.app.vault.delete(item, false);
      } catch (error) {
        errors.push(`Не удалось удалить пустую папку «${item.path}»: ${messageOf(error)}`);
      }
    }
  }

  private async removeStoredAfterFailedSourceDelete(path: string): Promise<void> {
    try {
      await this.app.vault.adapter.remove(path);
    } catch (error) {
      console.error("Опыт: не удалось откатить служебную копию после ошибки удаления", error);
    }
  }

  private async safeRemove(path: string): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
    } catch (error) {
      console.error("Опыт: не удалось удалить неполный служебный файл", error);
    }
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function installDeletionInterceptor(
  app: App,
  archiveFile: (file: TFile) => Promise<boolean>,
): () => void {
  const manager = app.fileManager as unknown as DeletionManager;
  return around(manager, {
    promptForDeletion: (next) => async function (this: DeletionManager, file: TAbstractFile): Promise<boolean> {
      if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") {
        return next.call(this, file);
      }
      return archiveFile(file);
    },
  });
}

export function isPathInFolder(path: string, folder: string): boolean {
  return !!folder && (path === folder || path.startsWith(`${folder}/`));
}

function recordFromStored(value: StoredExperience): ExperienceRecord {
  const record: ExperienceRecord = {
    archivedAt: value.archivedAt,
    archivedPath: value.archivedPath,
    originalPath: value.originalPath,
    title: value.title,
  };
  if (value.migratedFromPath) record.migratedFromPath = value.migratedFromPath;
  return record;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

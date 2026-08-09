import { around } from "monkey-around";
import { App, normalizePath, TAbstractFile, TFile } from "obsidian";

export interface ExperienceRecord {
  archivedAt: number;
  archivedPath: string;
  originalPath: string;
  title: string;
}

interface DeletionManager {
  promptForDeletion(file: TAbstractFile): Promise<boolean>;
}

export class ExperienceArchive {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly app: App,
    private readonly getFolder: () => string,
  ) {}

  archive(file: TFile): Promise<ExperienceRecord> {
    return this.enqueue(() => this.archiveNow(file));
  }

  isInside(path: string): boolean {
    return isPathInFolder(path, normalizePath(this.getFolder().trim()));
  }

  private async archiveNow(file: TFile): Promise<ExperienceRecord> {
    if (file.extension.toLocaleLowerCase() !== "md") {
      throw new Error("В опыт можно отправлять только Markdown-заметки.");
    }
    const folder = normalizePath(this.getFolder().trim());
    if (!folder || folder === ".") throw new Error("Не задана папка опыта.");
    if (this.isInside(file.path)) throw new Error("Заметка уже находится в опыте.");

    const originalPath = file.path;
    const title = file.basename;
    await this.ensureFolder(folder);
    const destination = this.uniquePath(normalizePath(`${folder}/${file.name}`));
    await this.app.fileManager.renameFile(file, destination);
    return { archivedAt: Date.now(), archivedPath: destination, originalPath, title };
  }

  private async ensureFolder(path: string): Promise<void> {
    let current = "";
    for (const part of path.split("/")) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw new Error(`«${current}» является файлом, а не папкой.`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }

  private uniquePath(path: string): string {
    let number = 0;
    while (this.app.vault.getAbstractFileByPath(addCollisionSuffix(path, number))) number++;
    return addCollisionSuffix(path, number);
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

export function installDeletionInterceptor(
  app: App,
  archive: ExperienceArchive,
  archiveFile: (file: TFile) => Promise<boolean>,
): () => void {
  const manager = app.fileManager as unknown as DeletionManager;
  return around(manager, {
    promptForDeletion: (next) => async function (this: DeletionManager, file: TAbstractFile): Promise<boolean> {
      if (!(file instanceof TFile)
        || file.extension.toLocaleLowerCase() !== "md"
        || archive.isInside(file.path)) {
        return next.call(this, file);
      }
      return archiveFile(file);
    },
  });
}

export function isPathInFolder(path: string, folder: string): boolean {
  return !!folder && (path === folder || path.startsWith(`${folder}/`));
}

function addCollisionSuffix(path: string, number: number): string {
  if (number === 0) return path;
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  const split = dot > slash ? dot : path.length;
  return `${path.slice(0, split)} (${number})${path.slice(split)}`;
}

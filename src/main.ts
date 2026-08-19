import {
  addIcon,
  MarkdownView,
  Menu,
  normalizePath,
  Notice,
  Plugin,
  TAbstractFile,
  TFile,
  type WorkspaceLeaf,
} from "obsidian";
import {
  ExperienceArchive,
  type ExperienceRecord,
  type GhostLineInput,
} from "./archive";
import { createExperienceEditorExtension, EditorRefreshBus } from "./editor";
import { ExperienceTitleIndex } from "./index";
import { cleanupLegacyIsolation } from "./legacy-cleanup";
import { highlightExperienceTitles } from "./reading";
import {
  type ExperienceData,
  type ExperienceSettings,
  ExperienceSettingTab,
  sanitizeData,
} from "./settings";
import { ExperienceArchiveView, EXPERIENCE_VIEW_TYPE } from "./view";

const EXPERIENCE_GHOST_TRASH_ICON = "experience-ghost-trash-v4";
const EXPERIENCE_GHOST_TRASH_SVG = [
  '<rect x="7" y="21" width="86" height="13" rx="4" fill="currentColor"/>',
  '<path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M13 35h74l-7 59H20l-7-59Zm31 25a8 12 0 1 1-16 0 8 12 0 1 1 16 0Zm28 0a8 12 0 1 1-16 0 8 12 0 1 1 16 0Z"/>',
  '<path d="M34 21V8h32v13" fill="none" stroke="currentColor" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>',
].join("");

export interface ExperienceGhostArchiveApiResult {
  archivedLines: number;
  failedNotes: Array<{ message: string; originalPath: string }>;
}

export interface ExperiencePublicApi {
  archiveDeletedCloneLines(inputs: GhostLineInput[]): Promise<ExperienceGhostArchiveApiResult>;
  version: 1;
}

export default class ExperiencePlugin extends Plugin {
  declare settings: ExperienceData;
  readonly api: ExperiencePublicApi = {
    archiveDeletedCloneLines: (inputs) => this.archiveDeletedCloneLines(inputs),
    version: 1,
  };
  private archive!: ExperienceArchive;
  private index = new ExperienceTitleIndex();
  private readonly refreshBus = new EditorRefreshBus();
  private ghostArchiveQueue: Promise<void> = Promise.resolve();
  private saveQueue: Promise<void> = Promise.resolve();
  private settingTab!: ExperienceSettingTab;

  async onload(): Promise<void> {
    addIcon(EXPERIENCE_GHOST_TRASH_ICON, EXPERIENCE_GHOST_TRASH_SVG);

    this.settings = sanitizeData(await this.loadData());
    this.archive = new ExperienceArchive(this.app, () => this.settings.folder);
    this.registerView(EXPERIENCE_VIEW_TYPE, (leaf) => new ExperienceArchiveView(
      leaf,
      this.archive,
      (path) => this.restoreArchivedEntry(path, leaf),
      (path) => this.deleteArchivedEntry(path, leaf),
    ));

    await this.reconcileArchive(false);
    this.rebuildIndex();
    this.applyHighlightColor();

    this.registerEditorExtension(createExperienceEditorExtension(
      this.index,
      this.refreshBus,
      (path, newLeaf) => this.openArchivedEntry(path, newLeaf),
    ));
    this.registerMarkdownPostProcessor((element) => {
      highlightExperienceTitles(
        element,
        this.index,
        (path, newLeaf) => this.openArchivedEntry(path, newLeaf),
      );
    });

    this.registerEvent(this.app.workspace.on("file-menu", (menu: Menu, file: TAbstractFile) => {
      if (!(file instanceof TFile) || file.extension.toLocaleLowerCase() !== "md") return;
      menu.addItem((item) => {
        item
          .setTitle("Отправить в опыт")
          .setIcon(EXPERIENCE_GHOST_TRASH_ICON)
          .setWarning(true)
          .setSection("danger")
          .onClick(() => void this.archiveNote(file));
        (item as unknown as { dom?: HTMLElement }).dom?.addClass("experience-archive-menu-item");
      });
    }));

    this.settingTab = new ExperienceSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addCommand({
      id: "reconcile-hidden-experience-archive",
      name: "Проверить скрытый архив и завершить перенос",
      callback: () => void this.reconcileArchive(true),
    });
    this.addCommand({
      id: "archive-active-note",
      name: "Отправить текущую заметку в опыт",
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || file.extension.toLocaleLowerCase() !== "md") return false;
        if (!checking) void this.archiveNote(file);
        return true;
      },
    });
    this.addCommand({
      id: "open-ghost-note-for-active-file",
      name: "Открыть призрачную копию текущей заметки",
      callback: () => void this.openGhostForActiveFile(),
    });

    this.app.workspace.onLayoutReady(() => void this.applyLegacyCleanup([]));
  }

  onunload(): void {
    document.documentElement.style.removeProperty("--experience-highlight-color");
    this.app.workspace.detachLeavesOfType(EXPERIENCE_VIEW_TYPE);
  }

  async onExternalSettingsChange(): Promise<void> {
    this.settings = sanitizeData(await this.loadData());
    this.applyHighlightColor();
    await this.reconcileArchive(false);
    this.settingTab?.display();
  }

  get archiveLocation(): string {
    return this.archive?.rootPath ?? `${this.app.vault.configDir}/experience-archive`;
  }

  get indexSize(): number {
    return this.index.size;
  }

  get ghostNoteCount(): number {
    return this.settings.records.filter((record) => record.kind === "ghost").length;
  }

  async updateSettings(changes: Partial<ExperienceSettings>): Promise<void> {
    Object.assign(this.settings, changes);
    await this.persist();
    this.applyHighlightColor();
    this.refreshIndexAndViews();
  }

  async reconcileArchive(showNotice: boolean): Promise<void> {
    const previousRecords = this.settings.records.map((record) => ({ ...record }));
    const stalePaths = previousRecords.flatMap((record) => this.archive.isStoredPath(record.archivedPath)
      ? []
      : [record.archivedPath, record.originalPath]);
    try {
      const result = await this.archive.initialize(previousRecords);
      this.settings.records = result.records;
      await this.applyLegacyCleanup([...stalePaths, ...result.staleVaultPaths]);
      await this.persist();
      this.refreshIndexAndViews();

      if (result.errors.length) {
        console.error("Опыт: перенос завершён с ошибками", result.errors);
        new Notice(
          `Скрытый архив проверен, но ${result.errors.length} объект(а) не перенесены. Исходные файлы сохранены.`,
          8000,
        );
      } else if (showNotice || result.migratedCount > 0) {
        const migration = result.migratedCount > 0
          ? ` Перенесено из старой папки: ${result.migratedCount}.`
          : "";
        new Notice(`Скрытый архив «Опыта» проверен.${migration}`);
      }
    } catch (error) {
      console.error("Опыт: не удалось подготовить скрытый архив", error);
      if (showNotice) new Notice(`Не удалось проверить скрытый архив: ${messageOf(error)}`, 8000);
    }
  }

  async archiveDeletedCloneLines(inputs: GhostLineInput[]): Promise<ExperienceGhostArchiveApiResult> {
    const operation = this.ghostArchiveQueue.then(
      () => this.archiveDeletedCloneLinesNow(inputs),
      () => this.archiveDeletedCloneLinesNow(inputs),
    );
    this.ghostArchiveQueue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async archiveDeletedCloneLinesNow(inputs: GhostLineInput[]): Promise<ExperienceGhostArchiveApiResult> {
    const result = await this.archive.appendGhostLines(inputs, this.settings.records);
    if (result.records.length) {
      const replaced = new Set(result.replacedArchivedPaths);
      const updatedOriginalPaths = new Set(result.records.map((record) => record.originalPath));
      this.settings.records = this.settings.records.filter((record) =>
        !replaced.has(record.archivedPath)
        && !(record.kind === "ghost" && updatedOriginalPaths.has(record.originalPath)),
      );
      this.settings.records.push(...result.records);
      await this.persist();
      this.refreshIndexAndViews();
    }
    return {
      archivedLines: result.appendedLineCount,
      failedNotes: result.errors,
    };
  }

  private async archiveNote(file: TFile): Promise<boolean> {
    const openLeaves = this.findOpenNoteLeaves(file);
    let record: ExperienceRecord;
    try {
      record = await this.archive.archive(file);
    } catch (error) {
      console.error("Опыт: не удалось сохранить заметку", error);
      new Notice(`Не удалось отправить «${file.name}» в опыт: ${messageOf(error)}`, 8000);
      return false;
    }

    this.closeArchivedNoteLeaves(openLeaves);
    this.settings.records = this.settings.records.filter((item) => item.archivedPath !== record.archivedPath);
    this.settings.records.push(record);
    try {
      await this.persist();
      new Notice(`«${record.title}» отправлена в скрытый архив «Опыт».`);
    } catch (error) {
      console.error("Опыт: не удалось сохранить запись указателя", error);
      new Notice("Заметка сохранена в скрытом архиве, но указатель будет восстановлен при перезапуске.", 8000);
    }
    this.refreshIndexAndViews();
    await this.applyLegacyCleanup([record.originalPath]);
    return true;
  }

  private async restoreArchivedEntry(archivedPath: string, leaf: WorkspaceLeaf): Promise<void> {
    const record = this.settings.records.find((item) => item.archivedPath === archivedPath);
    if (!record) {
      new Notice("Архивная заметка больше не существует.");
      return;
    }

    let restored: TFile | null = null;
    try {
      const entry = await this.archive.read(archivedPath);
      if (entry.kind === "ghost") throw new Error("Призрачные заметки нельзя восстанавливать как обычные файлы.");

      const destination = normalizePath(entry.originalPath);
      if (!destination || destination === "." || !destination.toLocaleLowerCase().endsWith(".md")) {
        throw new Error("Исходный путь заметки недопустим.");
      }
      if (this.app.vault.getAbstractFileByPath(destination) || await this.app.vault.adapter.exists(destination)) {
        throw new Error(`По исходному пути уже существует файл: ${destination}`);
      }

      await this.ensureParentFolders(destination);
      restored = await this.app.vault.create(destination, entry.content);
      const verified = await this.app.vault.read(restored);
      if (verified !== entry.content) throw new Error("Проверка восстановленного содержимого не пройдена.");

      try {
        await this.app.vault.adapter.remove(archivedPath);
        if (await this.app.vault.adapter.exists(archivedPath)) {
          throw new Error("Служебная архивная копия осталась после восстановления.");
        }
      } catch (error) {
        try {
          await this.app.vault.delete(restored, false);
        } catch (rollbackError) {
          console.error("Опыт: не удалось откатить восстановленную заметку", rollbackError);
        }
        restored = null;
        throw error;
      }
    } catch (error) {
      console.error("Опыт: не удалось восстановить архивную заметку", error);
      new Notice(`Не удалось восстановить «${record.title}»: ${messageOf(error)}`, 8000);
      return;
    }

    this.settings.records = this.settings.records.filter((item) => item.archivedPath !== archivedPath);
    try {
      await this.persist();
    } catch (error) {
      console.error("Опыт: восстановление выполнено, но не удалось сохранить указатель", error);
      new Notice("Заметка восстановлена, но указатель «Опыта» будет исправлен при следующем запуске.", 8000);
    }
    this.refreshIndexAndViews();
    await leaf.openFile(restored);
    new Notice(`«${record.title}» восстановлена из «Опыта».`);
  }

  private async deleteArchivedEntry(archivedPath: string, leaf: WorkspaceLeaf): Promise<void> {
    const record = this.settings.records.find((item) => item.archivedPath === archivedPath);
    if (!record) {
      new Notice("Архивная заметка больше не существует.");
      return;
    }

    try {
      await this.archive.read(archivedPath);
      await this.app.vault.adapter.remove(archivedPath);
      if (await this.app.vault.adapter.exists(archivedPath)) {
        throw new Error("Служебный файл остался после удаления.");
      }
    } catch (error) {
      console.error("Опыт: не удалось удалить архивную заметку", error);
      new Notice(`Не удалось удалить «${record.title}»: ${messageOf(error)}`, 8000);
      return;
    }

    this.settings.records = this.settings.records.filter((item) => item.archivedPath !== archivedPath);
    try {
      await this.persist();
    } catch (error) {
      console.error("Опыт: архив удалён, но не удалось сохранить указатель", error);
      new Notice("Архивная заметка удалена, но указатель «Опыта» будет исправлен при следующем запуске.", 8000);
    }
    this.refreshIndexAndViews();
    leaf.detach();
    new Notice(`«${record.title}» удалена из «Опыта».`);
  }

  private async ensureParentFolders(path: string): Promise<void> {
    const parts = normalizePath(path).split("/");
    parts.pop();
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      const existing = this.app.vault.getAbstractFileByPath(current);
      if (existing instanceof TFile) throw new Error(`«${current}» является файлом, а не папкой.`);
      if (!existing) await this.app.vault.createFolder(current);
    }
  }

  private async openArchivedEntry(path: string, newLeaf: boolean): Promise<void> {
    if (!this.settings.records.some((record) => record.archivedPath === path)) {
      new Notice("Архивная заметка больше не существует.");
      return;
    }
    const leaf = this.app.workspace.getLeaf(newLeaf);
    await leaf.setViewState({
      active: true,
      state: { archivedPath: path },
      type: EXPERIENCE_VIEW_TYPE,
    });
    this.app.workspace.revealLeaf(leaf);
  }

  private async openGhostForActiveFile(): Promise<void> {
    const file = this.app.workspace.getActiveFile();
    if (!file) {
      new Notice("Сначала откройте заметку.");
      return;
    }
    const ghost = this.settings.records
      .filter((record) => record.kind === "ghost" && record.originalPath === file.path)
      .sort((left, right) => right.archivedAt - left.archivedAt)[0];
    if (!ghost) {
      new Notice(`У «${file.basename}» пока нет призрачной копии.`);
      return;
    }
    await this.openArchivedEntry(ghost.archivedPath, false);
  }

  private findOpenNoteLeaves(file: TFile): WorkspaceLeaf[] {
    const originalPath = file.path;
    return this.app.workspace.getLeavesOfType("markdown").filter((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        return view.file === file || view.file?.path === originalPath;
      }

      const state = leaf.getViewState().state as { file?: unknown } | undefined;
      return state?.file === originalPath;
    });
  }

  private closeArchivedNoteLeaves(leaves: WorkspaceLeaf[]): void {
    for (const leaf of leaves) leaf.detach();
  }

  private async applyLegacyCleanup(stalePaths: string[]): Promise<void> {
    try {
      const safeStalePaths = stalePaths.filter((path) => {
        const current = this.app.vault.getAbstractFileByPath(path);
        return !current || this.archive.isLegacyPath(path);
      });
      const legacyFolderStillExists = !!this.app.vault.getAbstractFileByPath(this.settings.folder);
      const next = await cleanupLegacyIsolation(
        this.app,
        this.settings.isolationState,
        safeStalePaths,
        !legacyFolderStillExists,
      );
      if (JSON.stringify(next) !== JSON.stringify(this.settings.isolationState)) {
        this.settings.isolationState = next;
        await this.persist();
      }
    } catch (error) {
      console.error("Опыт: не удалось очистить старые исключения", error);
    }
  }

  private rebuildIndex(): void {
    this.index.rebuild(this.settings.records, this.settings.similarityThreshold);
  }

  private refreshIndexAndViews(): void {
    this.rebuildIndex();
    this.refreshBus.refresh();
    this.refreshReadingViews();
  }

  private refreshReadingViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      const view = leaf.view;
      if (!(view instanceof MarkdownView) || view.getMode() !== "preview") continue;
      const previewMode = (view as unknown as { previewMode?: { rerender(force?: boolean): void } }).previewMode;
      previewMode?.rerender(true);
    }
  }

  private applyHighlightColor(): void {
    document.documentElement.style.setProperty("--experience-highlight-color", this.settings.highlightColor);
  }

  private persist(): Promise<void> {
    const snapshot: ExperienceData = {
      ...this.settings,
      isolationState: { ...this.settings.isolationState },
      records: this.settings.records.map((record) => ({ ...record })),
    };
    const result = this.saveQueue.then(() => this.saveData(snapshot));
    this.saveQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

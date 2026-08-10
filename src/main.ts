import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { ExperienceArchive, installDeletionInterceptor, type ExperienceRecord } from "./archive";
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

export default class ExperiencePlugin extends Plugin {
  declare settings: ExperienceData;
  private archive!: ExperienceArchive;
  private index = new ExperienceTitleIndex();
  private readonly refreshBus = new EditorRefreshBus();
  private saveQueue: Promise<void> = Promise.resolve();
  private settingTab!: ExperienceSettingTab;

  async onload(): Promise<void> {
    this.settings = sanitizeData(await this.loadData());
    this.archive = new ExperienceArchive(this.app, () => this.settings.folder);
    this.registerView(EXPERIENCE_VIEW_TYPE, (leaf) => new ExperienceArchiveView(leaf, this.archive));

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
    this.register(installDeletionInterceptor(this.app, (file) => this.archiveDeletedNote(file)));

    this.settingTab = new ExperienceSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addCommand({
      id: "reconcile-hidden-experience-archive",
      name: "Проверить скрытый архив и завершить перенос",
      callback: () => void this.reconcileArchive(true),
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

  private async archiveDeletedNote(file: TFile): Promise<boolean> {
    const openLeaves = this.findOpenNoteLeaves(file);
    let record: ExperienceRecord;
    try {
      record = await this.archive.archive(file);
    } catch (error) {
      console.error("Опыт: не удалось сохранить удаляемую заметку", error);
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

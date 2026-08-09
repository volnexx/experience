import { MarkdownView, Notice, Plugin, TFile, type WorkspaceLeaf } from "obsidian";
import { ExperienceArchive, installDeletionInterceptor, isPathInFolder, type ExperienceRecord } from "./archive";
import { createExperienceEditorExtension, EditorRefreshBus } from "./editor";
import { ExperienceTitleIndex } from "./index";
import { highlightExperienceTitles } from "./reading";
import {
  DEFAULT_ISOLATION_STATUS,
  ExperienceIsolation,
  type ExperienceIsolationStatus,
  type IsolationPartStatus,
} from "./isolation";
import {
  type ExperienceData,
  type ExperienceSettings,
  ExperienceSettingTab,
  sanitizeData,
} from "./settings";

export default class ExperiencePlugin extends Plugin {
  declare settings: ExperienceData;
  private archive!: ExperienceArchive;
  private index!: ExperienceTitleIndex;
  private readonly refreshBus = new EditorRefreshBus();
  private saveQueue: Promise<void> = Promise.resolve();
  private settingTab!: ExperienceSettingTab;
  private isolation!: ExperienceIsolation;
  private isolationStatus: ExperienceIsolationStatus = { ...DEFAULT_ISOLATION_STATUS };

  async onload(): Promise<void> {
    this.settings = sanitizeData(await this.loadData());
    this.archive = new ExperienceArchive(this.app, () => this.settings.folder);
    this.index = new ExperienceTitleIndex(this.app.vault);
    this.isolation = new ExperienceIsolation(
      this.app,
      () => this.settings.folder,
      () => this.settings.isolationState,
      () => this.settings.records.flatMap((record) => [record.originalPath, record.archivedPath]),
      async (state) => {
        this.settings.isolationState = state;
        await this.persist();
      },
    );
    this.rebuildIndex();
    this.applyHighlightColor();

    this.registerEditorExtension(createExperienceEditorExtension(this.app, this.index, this.refreshBus));
    this.registerMarkdownPostProcessor((element, context) => {
      highlightExperienceTitles(element, this.index, this.app, context.sourcePath);
    });
    this.register(installDeletionInterceptor(this.app, this.archive, (file) => this.archiveDeletedNote(file)));

    this.settingTab = new ExperienceSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);
    this.addCommand({
      id: "apply-experience-folder-isolation",
      name: "Применить изоляцию папки опыта",
      callback: () => void this.applyIsolation(true),
    });

    void this.applyIsolation(false);
    this.app.workspace.onLayoutReady(() => void this.applyIsolation(false));

    this.registerEvent(this.app.vault.on("create", (file) => {
      if (file instanceof TFile) this.refreshIndexAndViews();
    }));
    this.registerEvent(this.app.vault.on("delete", (file) => {
      if (!(file instanceof TFile)) return;
      const previousLength = this.settings.records.length;
      this.settings.records = this.settings.records.filter((record) => record.archivedPath !== file.path);
      if (this.settings.records.length !== previousLength) void this.persist();
      this.refreshIndexAndViews();
    }));
    this.registerEvent(this.app.vault.on("rename", (file, oldPath) => {
      if (!(file instanceof TFile)) return;
      void this.reconcileRename(file, oldPath);
    }));
  }

  onunload(): void {
    document.documentElement.style.removeProperty("--experience-highlight-color");
  }

  async onExternalSettingsChange(): Promise<void> {
    this.settings = sanitizeData(await this.loadData());
    this.applyHighlightColor();
    this.refreshIndexAndViews();
    await this.applyIsolation(false);
    this.settingTab?.display();
  }

  get indexSize(): number {
    return this.index?.size ?? 0;
  }

  get isolationDescription(): string {
    return [
      `Obsidian: ${statusLabel(this.isolationStatus.core)}`,
      `Virtual Linker: ${statusLabel(this.isolationStatus.virtualLinker)}`,
      `Omnisearch: ${statusLabel(this.isolationStatus.omnisearch)}`,
    ].join("; ");
  }

  async updateSettings(changes: Partial<ExperienceSettings>): Promise<void> {
    Object.assign(this.settings, changes);
    await this.persist();
    this.applyHighlightColor();
    this.refreshIndexAndViews();
    await this.applyIsolation(false);
  }

  async applyIsolation(showNotice: boolean, stalePaths: string[] = []): Promise<void> {
    this.isolationStatus = await this.isolation.ensure(stalePaths);
    if (showNotice) new Notice(`Изоляция применена. ${this.isolationDescription}`);
  }

  private async archiveDeletedNote(file: TFile): Promise<boolean> {
    const openLeaves = this.findOpenNoteLeaves(file);
    let record: ExperienceRecord;
    try {
      record = await this.archive.archive(file);
    } catch (error) {
      console.error("Опыт: не удалось перенести заметку", error);
      new Notice(`Не удалось отправить «${file.name}» в опыт: ${messageOf(error)}`);
      return false;
    }

    this.closeArchivedNoteLeaves(openLeaves);
    this.settings.records = this.settings.records.filter((item) => item.archivedPath !== record.archivedPath);
    this.settings.records.push(record);
    try {
      await this.persist();
      new Notice(`Заметка отправлена в «${record.archivedPath}».`);
    } catch (error) {
      console.error("Опыт: не удалось сохранить запись", error);
      new Notice(`Заметка отправлена в «${record.archivedPath}», но исходное название не удалось записать.`);
    }
    this.refreshIndexAndViews();
    await this.applyIsolation(false, [record.originalPath, record.archivedPath]);
    return true;
  }

  private findOpenNoteLeaves(file: TFile): WorkspaceLeaf[] {
    const originalPath = file.path;
    return this.app.workspace.getLeavesOfType("markdown").filter((leaf) => {
      const view = leaf.view;
      if (view instanceof MarkdownView) {
        return view.file === file || view.file?.path === originalPath;
      }

      // A background tab can be deferred and therefore have no MarkdownView yet.
      const state = leaf.getViewState().state as { file?: unknown } | undefined;
      return state?.file === originalPath;
    });
  }

  private closeArchivedNoteLeaves(leaves: WorkspaceLeaf[]): void {
    for (const leaf of leaves) leaf.detach();
  }

  private async reconcileRename(file: TFile, oldPath: string): Promise<void> {
    const recordIndex = this.settings.records.findIndex((record) => record.archivedPath === oldPath);
    const touchesExperience = recordIndex >= 0
      || isPathInFolder(oldPath, this.settings.folder)
      || isPathInFolder(file.path, this.settings.folder);
    if (recordIndex >= 0) {
      if (isPathInFolder(file.path, this.settings.folder)) {
        const record = this.settings.records[recordIndex];
        if (record) this.settings.records[recordIndex] = { ...record, archivedPath: file.path };
      } else {
        this.settings.records.splice(recordIndex, 1);
      }
      try {
        await this.persist();
      } catch (error) {
        console.error("Опыт: не удалось обновить запись после переименования", error);
      }
    }
    this.refreshIndexAndViews();
    if (touchesExperience) await this.applyIsolation(false, [oldPath, file.path]);
  }

  private rebuildIndex(): void {
    this.index.rebuild(this.settings.folder, this.settings.records, this.settings.similarityThreshold);
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

function statusLabel(status: IsolationPartStatus): string {
  switch (status) {
    case "active": return "включена";
    case "not-loaded": return "расширение не включено";
    case "unavailable": return "не поддерживается этой версией";
    case "error": return "ошибка";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { ItemView, MarkdownRenderer, type ViewStateResult, type WorkspaceLeaf } from "obsidian";
import type { ExperienceArchive, StoredExperience } from "./archive";

export const EXPERIENCE_VIEW_TYPE = "experience-archive-view";

interface ExperienceViewState {
  archivedPath?: unknown;
}

export class ExperienceArchiveView extends ItemView {
  private archivedPath = "";
  private entry: StoredExperience | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly archive: ExperienceArchive,
  ) {
    super(leaf);
    this.navigation = true;
  }

  getViewType(): string {
    return EXPERIENCE_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.entry?.title ?? "Опыт";
  }

  getIcon(): string {
    return "archive";
  }

  getState(): Record<string, unknown> {
    return { archivedPath: this.archivedPath };
  }

  async setState(state: unknown, result: ViewStateResult): Promise<void> {
    const value = state as ExperienceViewState | null;
    this.archivedPath = typeof value?.archivedPath === "string" ? value.archivedPath : "";
    result.history = true;
    await this.renderEntry();
  }

  protected async onOpen(): Promise<void> {
    await this.renderEntry();
  }

  private async renderEntry(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("experience-archive-view");
    this.entry = null;

    if (!this.archivedPath) {
      this.renderMessage("Архивная заметка не выбрана.");
      return;
    }

    try {
      const entry = await this.archive.read(this.archivedPath);
      this.entry = entry;
      const header = this.contentEl.createDiv({ cls: "experience-archive-header" });
      header.createDiv({
        cls: "experience-archive-label",
        text: entry.kind === "ghost" ? "Призрачная заметка · удалённые строки" : "Архивная заметка",
      });
      header.createEl("h1", { cls: "experience-archive-title", text: entry.title });
      header.createDiv({
        cls: "experience-archive-meta",
        text: `${entry.originalPath} · ${new Date(entry.archivedAt).toLocaleString()}`,
      });
      const body = this.contentEl.createDiv({ cls: "experience-archive-content markdown-rendered" });
      await MarkdownRenderer.render(this.app, entry.content, body, entry.originalPath, this);
    } catch (error) {
      this.renderMessage(`Не удалось открыть архивную заметку: ${messageOf(error)}`);
    }
  }

  private renderMessage(text: string): void {
    this.contentEl.createDiv({ cls: "experience-archive-message", text });
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

import { App, normalizePath, PluginSettingTab, Setting } from "obsidian";
import type ExperiencePlugin from "./main";
import type { ExperienceRecord } from "./archive";
import {
  DEFAULT_ISOLATION_STATE,
  sanitizeIsolationState,
  type ExperienceIsolationState,
} from "./isolation-state";

export interface ExperienceSettings {
  folder: string;
  highlightColor: string;
  similarityThreshold: number;
}

export interface ExperienceData extends ExperienceSettings {
  isolationState: ExperienceIsolationState;
  records: ExperienceRecord[];
}

export const DEFAULT_SETTINGS: ExperienceSettings = {
  folder: "опыт",
  highlightColor: "#ffffff",
  similarityThreshold: 0.9,
};

export const DEFAULT_DATA: ExperienceData = {
  ...DEFAULT_SETTINGS,
  isolationState: { ...DEFAULT_ISOLATION_STATE },
  records: [],
};

export function sanitizeData(value: unknown): ExperienceData {
  const stored = isRecord(value) ? value : {};
  const folder = typeof stored.folder === "string" && !validateFolder(stored.folder)
    ? normalizePath(stored.folder.trim())
    : DEFAULT_SETTINGS.folder;
  const highlightColor = typeof stored.highlightColor === "string" && /^#[0-9a-f]{6}$/iu.test(stored.highlightColor)
    ? stored.highlightColor
    : DEFAULT_SETTINGS.highlightColor;
  const similarityThreshold = typeof stored.similarityThreshold === "number" && Number.isFinite(stored.similarityThreshold)
    ? Math.min(1, Math.max(0.5, stored.similarityThreshold))
    : DEFAULT_SETTINGS.similarityThreshold;
  const records = Array.isArray(stored.records) ? stored.records.filter(isExperienceRecord) : [];
  const isolationState = sanitizeIsolationState(stored.isolationState);
  return { folder, highlightColor, similarityThreshold, isolationState, records };
}

export function validateFolder(value: string): string | undefined {
  const folder = value.trim();
  if (!folder || folder === ".") return "Введите название папки.";
  if (folder.startsWith("/") || folder.includes("\\")) return "Используйте путь от корня хранилища и прямые косые черты.";
  if (folder.split("/").some((part) => !part || part === "." || part === "..")) return "Путь содержит недопустимую часть.";
  return undefined;
}

export class ExperienceSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: ExperiencePlugin) {
    super(app, plugin);
  }

  display(): void {
    this.containerEl.empty();
    this.containerEl.createEl("h2", { text: "Опыт" });

    new Setting(this.containerEl)
      .setName("Папка опыта")
      .setDesc("Удаляемые Markdown-заметки будут переноситься в эту папку внутри хранилища.")
      .addText((text) => {
        text.setPlaceholder("опыт").setValue(this.plugin.settings.folder);
        text.onChange(async (value) => {
          const error = validateFolder(value);
          text.inputEl.toggleClass("experience-setting-error", !!error);
          if (!error) await this.plugin.updateSettings({ folder: normalizePath(value.trim()) });
        });
      });

    new Setting(this.containerEl)
      .setName("Минимальное сходство")
      .setDesc("Процент сходства словосочетания с названием заметки. По умолчанию — 90%.")
      .addText((text) => {
        text.inputEl.type = "number";
        text.inputEl.min = "50";
        text.inputEl.max = "100";
        text.inputEl.step = "1";
        text.setValue(String(Math.round(this.plugin.settings.similarityThreshold * 100)));
        text.onChange(async (value) => {
          const number = Number(value);
          const valid = Number.isFinite(number) && number >= 50 && number <= 100;
          text.inputEl.toggleClass("experience-setting-error", !valid);
          if (valid) await this.plugin.updateSettings({ similarityThreshold: number / 100 });
        });
      });

    new Setting(this.containerEl)
      .setName("Цвет совпадений")
      .setDesc("По умолчанию совпадения отображаются чисто белым цветом.")
      .addColorPicker((picker) => picker
        .setValue(this.plugin.settings.highlightColor)
        .onChange(async (value) => this.plugin.updateSettings({ highlightColor: value })));

    new Setting(this.containerEl)
      .setName("Изоляция папки опыта")
      .setDesc(this.plugin.isolationDescription)
      .addButton((button) => button
        .setButtonText("Применить сейчас")
        .onClick(async () => {
          button.setDisabled(true);
          await this.plugin.applyIsolation(true);
          this.display();
        }));

    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `Сейчас в указателе опыта: ${this.plugin.indexSize} заметок.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isExperienceRecord(value: unknown): value is ExperienceRecord {
  return isRecord(value)
    && typeof value.archivedAt === "number"
    && Number.isFinite(value.archivedAt)
    && typeof value.archivedPath === "string"
    && !!value.archivedPath
    && typeof value.originalPath === "string"
    && !!value.originalPath
    && typeof value.title === "string"
    && !!value.title;
}

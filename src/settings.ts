import { App, normalizePath, PluginSettingTab, Setting } from "obsidian";
import type ExperiencePlugin from "./main";
import { isExperienceRecord, type ExperienceRecord } from "./archive-format";
import {
  DEFAULT_ISOLATION_STATE,
  sanitizeIsolationState,
  type ExperienceIsolationState,
} from "./isolation-state";

export interface ExperienceSettings {
  highlightColor: string;
  similarityThreshold: number;
}

export interface ExperienceData extends ExperienceSettings {
  folder: string;
  isolationState: ExperienceIsolationState;
  records: ExperienceRecord[];
}

export const DEFAULT_SETTINGS: ExperienceSettings = {
  highlightColor: "#ffffff",
  similarityThreshold: 0.9,
};

export const DEFAULT_DATA: ExperienceData = {
  ...DEFAULT_SETTINGS,
  folder: "опыт",
  isolationState: { ...DEFAULT_ISOLATION_STATE },
  records: [],
};

export function sanitizeData(value: unknown): ExperienceData {
  const stored = isRecord(value) ? value : {};
  const folder = typeof stored.folder === "string" && !validateFolder(stored.folder)
    ? normalizePath(stored.folder.trim())
    : DEFAULT_DATA.folder;
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
      .setName("Скрытое хранилище")
      .setDesc(`Архив находится в «${this.plugin.archiveLocation}» и не входит в дерево заметок Obsidian.`)
      .addButton((button) => button
        .setButtonText("Проверить сейчас")
        .onClick(async () => {
          button.setDisabled(true);
          await this.plugin.reconcileArchive(true);
          this.display();
        }));

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

    this.containerEl.createEl("p", {
      cls: "setting-item-description",
      text: `Сейчас в скрытом архиве и указателе: ${this.plugin.indexSize} заметок.`,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

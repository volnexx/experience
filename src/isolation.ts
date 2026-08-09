import { App, normalizePath } from "obsidian";
import { isPathInFolder } from "./archive";
import {
  ignoreFilterForFolder,
  type ExperienceIsolationState,
} from "./isolation-state";

export interface ExperienceIsolationStatus {
  core: IsolationPartStatus;
  omnisearch: IsolationPartStatus;
  virtualLinker: IsolationPartStatus;
}

export type IsolationPartStatus = "active" | "not-loaded" | "unavailable" | "error";

export const DEFAULT_ISOLATION_STATUS: ExperienceIsolationStatus = {
  core: "unavailable",
  omnisearch: "not-loaded",
  virtualLinker: "not-loaded",
};

interface ConfigurableVault {
  getConfig?(key: string): unknown;
  setConfig?(key: string, value: unknown): Promise<void> | void;
}

interface PluginRegistry {
  plugins?: Record<string, unknown>;
}

interface AppWithPlugins {
  plugins?: PluginRegistry;
}

interface VirtualLinkerSettings {
  excludedDirectories?: unknown;
  excludedDirectoriesForLinking?: unknown;
}

interface VirtualLinkerPlugin {
  settings?: VirtualLinkerSettings;
  updateManager?: { update?(): void };
  updateSettings?(changes: Partial<VirtualLinkerSettings>): Promise<void>;
}

interface OmnisearchPlugin {
  settings?: { hideExcluded?: boolean; [key: string]: unknown };
  saveData?(data: unknown): Promise<void>;
  documentsRepository?: { removeDocument?(path: string): unknown };
  embedsRepository?: { removeFile?(path: string): unknown };
  searchEngine?: { removeFromPaths?(paths: string[]): unknown };
}

export class ExperienceIsolation {
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly app: App,
    private readonly getFolder: () => string,
    private readonly getState: () => ExperienceIsolationState,
    private readonly getKnownPaths: () => string[],
    private readonly saveState: (state: ExperienceIsolationState) => Promise<void>,
  ) {}

  ensure(additionalPaths: string[] = []): Promise<ExperienceIsolationStatus> {
    return this.enqueue(() => this.ensureNow(additionalPaths));
  }

  private async ensureNow(additionalPaths: string[]): Promise<ExperienceIsolationStatus> {
    const folder = normalizePath(this.getFolder().trim());
    const previousState = this.getState();
    const nextState = { ...previousState };
    const status: ExperienceIsolationStatus = { ...DEFAULT_ISOLATION_STATUS };

    try {
      status.core = await this.ensureCoreExclusion(folder, nextState);
    } catch (error) {
      console.error("Опыт: не удалось применить системное исключение", error);
      status.core = "error";
    }

    try {
      status.virtualLinker = await this.ensureVirtualLinkerExclusion(folder, nextState);
    } catch (error) {
      console.error("Опыт: не удалось исключить папку из Virtual Linker", error);
      status.virtualLinker = "error";
    }

    try {
      status.omnisearch = await this.ensureOmnisearchExclusion(folder, additionalPaths);
    } catch (error) {
      console.error("Опыт: не удалось исключить папку из Omnisearch", error);
      status.omnisearch = "error";
    }

    if (!isIsolationStateEqual(previousState, nextState)) await this.saveState(nextState);
    return status;
  }

  private async ensureCoreExclusion(
    folder: string,
    state: ExperienceIsolationState,
  ): Promise<IsolationPartStatus> {
    const vault = this.app.vault as unknown as ConfigurableVault;
    if (typeof vault.getConfig !== "function" || typeof vault.setConfig !== "function") return "unavailable";

    let filters = stringArray(vault.getConfig("userIgnoreFilters"));
    let changed = false;

    if (state.coreFolder && state.coreFolder !== folder && state.coreFilterManaged) {
      const previousFilter = ignoreFilterForFolder(state.coreFolder);
      const withoutPrevious = filters.filter((filter) => filter !== previousFilter);
      changed = changed || withoutPrevious.length !== filters.length;
      filters = withoutPrevious;
    }

    let managed = state.coreFolder === folder && state.coreFilterManaged;
    const filter = ignoreFilterForFolder(folder);
    if (!filters.includes(filter)) {
      filters.push(filter);
      managed = true;
      changed = true;
    }

    if (changed) await vault.setConfig("userIgnoreFilters", filters);
    state.coreFolder = folder;
    state.coreFilterManaged = managed;
    return "active";
  }

  private async ensureVirtualLinkerExclusion(
    folder: string,
    state: ExperienceIsolationState,
  ): Promise<IsolationPartStatus> {
    const plugin = getLoadedPlugin(this.app, "virtual-linker") as VirtualLinkerPlugin | undefined;
    if (!plugin) return "not-loaded";
    if (!plugin.settings || typeof plugin.updateSettings !== "function") return "unavailable";

    let excludedMatches = stringArray(plugin.settings.excludedDirectories);
    let excludedSources = stringArray(plugin.settings.excludedDirectoriesForLinking);
    let changed = false;

    if (state.virtualLinkerFolder && state.virtualLinkerFolder !== folder) {
      if (state.virtualLinkerMatchesManaged) {
        const filtered = excludedMatches.filter((path) => path !== state.virtualLinkerFolder);
        changed = changed || filtered.length !== excludedMatches.length;
        excludedMatches = filtered;
      }
      if (state.virtualLinkerSourcesManaged) {
        const filtered = excludedSources.filter((path) => path !== state.virtualLinkerFolder);
        changed = changed || filtered.length !== excludedSources.length;
        excludedSources = filtered;
      }
    }

    let matchesManaged = state.virtualLinkerFolder === folder && state.virtualLinkerMatchesManaged;
    let sourcesManaged = state.virtualLinkerFolder === folder && state.virtualLinkerSourcesManaged;

    if (!excludedMatches.includes(folder)) {
      excludedMatches.push(folder);
      matchesManaged = true;
      changed = true;
    }
    if (!excludedSources.includes(folder)) {
      excludedSources.push(folder);
      sourcesManaged = true;
      changed = true;
    }

    if (changed) {
      await plugin.updateSettings({
        excludedDirectories: excludedMatches,
        excludedDirectoriesForLinking: excludedSources,
      });
      plugin.updateManager?.update?.();
    }

    state.virtualLinkerFolder = folder;
    state.virtualLinkerMatchesManaged = matchesManaged;
    state.virtualLinkerSourcesManaged = sourcesManaged;
    return "active";
  }

  private async ensureOmnisearchExclusion(folder: string, additionalPaths: string[]): Promise<IsolationPartStatus> {
    const plugin = getLoadedPlugin(this.app, "omnisearch") as OmnisearchPlugin | undefined;
    if (!plugin) return "not-loaded";
    if (!plugin.settings || typeof plugin.saveData !== "function") return "unavailable";

    if (plugin.settings.hideExcluded !== true) {
      plugin.settings.hideExcluded = true;
      await plugin.saveData(plugin.settings);
    }

    const currentPaths = this.app.vault.getFiles()
      .filter((file) => isPathInFolder(file.path, folder))
      .map((file) => file.path);
    const paths = [...new Set([...currentPaths, ...this.getKnownPaths(), ...additionalPaths].filter(Boolean))];
    if (paths.length) {
      plugin.searchEngine?.removeFromPaths?.(paths);
      for (const path of paths) {
        plugin.documentsRepository?.removeDocument?.(path);
        plugin.embedsRepository?.removeFile?.(path);
      }
    }
    return "active";
  }

  private enqueue<Result>(operation: () => Promise<Result>): Promise<Result> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(() => undefined, () => undefined);
    return result;
  }
}

function getLoadedPlugin(app: App, id: string): unknown {
  return (app as unknown as AppWithPlugins).plugins?.plugins?.[id];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function isIsolationStateEqual(left: ExperienceIsolationState, right: ExperienceIsolationState): boolean {
  return left.coreFolder === right.coreFolder
    && left.coreFilterManaged === right.coreFilterManaged
    && left.virtualLinkerFolder === right.virtualLinkerFolder
    && left.virtualLinkerMatchesManaged === right.virtualLinkerMatchesManaged
    && left.virtualLinkerSourcesManaged === right.virtualLinkerSourcesManaged;
}

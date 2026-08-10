import { type App } from "obsidian";
import { ignoreFilterForFolder, type ExperienceIsolationState } from "./isolation-state";

interface ConfigurableVault {
  getConfig?(key: string): unknown;
  setConfig?(key: string, value: unknown): Promise<void> | void;
}

interface AppWithPlugins {
  plugins?: { plugins?: Record<string, unknown> };
}

interface VirtualLinkerPlugin {
  settings?: {
    excludedDirectories?: unknown;
    excludedDirectoriesForLinking?: unknown;
  };
  updateManager?: { update?(): void };
  updateSettings?(changes: Record<string, unknown>): Promise<void>;
}

interface OmnisearchPlugin {
  documentsRepository?: { removeDocument?(path: string): unknown };
  embedsRepository?: { removeFile?(path: string): unknown };
  searchEngine?: { removeFromPaths?(paths: string[]): unknown };
}

export async function cleanupLegacyIsolation(
  app: App,
  state: ExperienceIsolationState,
  stalePaths: string[],
  releaseManagedExclusions: boolean,
): Promise<ExperienceIsolationState> {
  const next = { ...state };
  if (releaseManagedExclusions) {
    await cleanupCore(app, next);
    await cleanupVirtualLinker(app, next);
  }
  cleanupOmnisearch(app, stalePaths);
  return next;
}

async function cleanupCore(app: App, state: ExperienceIsolationState): Promise<void> {
  if (!state.coreFolder || !state.coreFilterManaged) return;
  const vault = app.vault as unknown as ConfigurableVault;
  if (typeof vault.getConfig !== "function" || typeof vault.setConfig !== "function") return;
  const filter = ignoreFilterForFolder(state.coreFolder);
  const current = stringArray(vault.getConfig("userIgnoreFilters"));
  const next = current.filter((item) => item !== filter);
  if (next.length !== current.length) await vault.setConfig("userIgnoreFilters", next);
  state.coreFilterManaged = false;
  state.coreFolder = "";
}

async function cleanupVirtualLinker(app: App, state: ExperienceIsolationState): Promise<void> {
  if (!state.virtualLinkerFolder
    || (!state.virtualLinkerMatchesManaged && !state.virtualLinkerSourcesManaged)) return;
  const plugin = getLoadedPlugin(app, "virtual-linker") as VirtualLinkerPlugin | undefined;
  if (!plugin?.settings || typeof plugin.updateSettings !== "function") return;

  const changes: Record<string, unknown> = {};
  if (state.virtualLinkerMatchesManaged) {
    changes.excludedDirectories = stringArray(plugin.settings.excludedDirectories)
      .filter((path) => path !== state.virtualLinkerFolder);
  }
  if (state.virtualLinkerSourcesManaged) {
    changes.excludedDirectoriesForLinking = stringArray(plugin.settings.excludedDirectoriesForLinking)
      .filter((path) => path !== state.virtualLinkerFolder);
  }
  await plugin.updateSettings(changes);
  plugin.updateManager?.update?.();
  state.virtualLinkerFolder = "";
  state.virtualLinkerMatchesManaged = false;
  state.virtualLinkerSourcesManaged = false;
}

function cleanupOmnisearch(app: App, stalePaths: string[]): void {
  const paths = [...new Set(stalePaths.filter(Boolean))];
  if (!paths.length) return;
  const plugin = getLoadedPlugin(app, "omnisearch") as OmnisearchPlugin | undefined;
  if (!plugin) return;
  plugin.searchEngine?.removeFromPaths?.(paths);
  for (const path of paths) {
    plugin.documentsRepository?.removeDocument?.(path);
    plugin.embedsRepository?.removeFile?.(path);
  }
}

function getLoadedPlugin(app: App, id: string): unknown {
  return (app as unknown as AppWithPlugins).plugins?.plugins?.[id];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

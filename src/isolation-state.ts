export interface ExperienceIsolationState {
  coreFolder: string;
  coreFilterManaged: boolean;
  virtualLinkerFolder: string;
  virtualLinkerMatchesManaged: boolean;
  virtualLinkerSourcesManaged: boolean;
}

export const DEFAULT_ISOLATION_STATE: ExperienceIsolationState = {
  coreFolder: "",
  coreFilterManaged: false,
  virtualLinkerFolder: "",
  virtualLinkerMatchesManaged: false,
  virtualLinkerSourcesManaged: false,
};

export function ignoreFilterForFolder(folder: string): string {
  const normalized = folder.trim().replaceAll("\\", "/").replace(/\/{2,}/gu, "/").replace(/\/$/u, "");
  return `${normalized}/`;
}

export function sanitizeIsolationState(value: unknown): ExperienceIsolationState {
  if (!isRecord(value)) return { ...DEFAULT_ISOLATION_STATE };
  return {
    coreFolder: typeof value.coreFolder === "string" ? value.coreFolder : "",
    coreFilterManaged: value.coreFilterManaged === true,
    virtualLinkerFolder: typeof value.virtualLinkerFolder === "string" ? value.virtualLinkerFolder : "",
    virtualLinkerMatchesManaged: value.virtualLinkerMatchesManaged === true,
    virtualLinkerSourcesManaged: value.virtualLinkerSourcesManaged === true,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { resolveOpenCodexDataPaths } from "./preflight"

export type OpenCodexBackendProviderFamily =
  | "openai-compatible"
  | "anthropic-compatible"
  | "custom"

export interface OpenCodexBackendConfigRecord {
  providerFamily: OpenCodexBackendProviderFamily
  baseUrl: string
  model: string
  apiKey: string
}

function getBackendConfigPath(userDataPath: string): string {
  return join(resolveOpenCodexDataPaths(userDataPath).stateDir, "backend-config.json")
}

function normalizeConfig(config: OpenCodexBackendConfigRecord): OpenCodexBackendConfigRecord {
  return {
    providerFamily: config.providerFamily,
    baseUrl: config.baseUrl.trim(),
    model: config.model.trim(),
    apiKey: config.apiKey.trim(),
  }
}

export function readOpenCodexBackendConfig({
  userDataPath,
}: {
  userDataPath: string
}): OpenCodexBackendConfigRecord | null {
  const filePath = getBackendConfigPath(userDataPath)
  if (!existsSync(filePath)) {
    return null
  }

  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<OpenCodexBackendConfigRecord>
  if (
    parsed.providerFamily !== "openai-compatible" &&
    parsed.providerFamily !== "anthropic-compatible" &&
    parsed.providerFamily !== "custom"
  ) {
    return null
  }

  if (
    typeof parsed.baseUrl !== "string" ||
    typeof parsed.model !== "string" ||
    typeof parsed.apiKey !== "string"
  ) {
    return null
  }

  return normalizeConfig(parsed as OpenCodexBackendConfigRecord)
}

export function saveOpenCodexBackendConfig({
  userDataPath,
  config,
}: {
  userDataPath: string
  config: OpenCodexBackendConfigRecord
}): OpenCodexBackendConfigRecord {
  const filePath = getBackendConfigPath(userDataPath)
  const normalized = normalizeConfig(config)

  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(normalized, null, 2), "utf8")
  return normalized
}

export function resetOpenCodexBackendConfig({
  userDataPath,
}: {
  userDataPath: string
}): void {
  rmSync(getBackendConfigPath(userDataPath), { force: true })
}

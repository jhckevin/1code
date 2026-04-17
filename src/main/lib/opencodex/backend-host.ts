import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve, join } from "node:path"
import { createInterface } from "node:readline"
import {
  getOpenCodexBackendProviderFamily,
  openCodexBackendRouteRequiresHost,
  type OpenCodexBackendRoute,
} from "../../../shared/opencodex-backend-route"
import {
  readOpenCodexBackendConfig,
  type OpenCodexBackendConfigRecord,
} from "./backend-config"
import { resolveOpenCodexDataPaths } from "./preflight"

export interface OpenCodexBackendHostPaths {
  rootDir: string
  configDir: string
  dataDir: string
  logsDir: string
}

export interface OpenCodexBackendHostLaunchSpec {
  command: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  inlineScript: string
}

export interface OpenCodexBackendHostState {
  status: "stopped" | "starting" | "ready" | "error"
  pid: number | null
  startedAt: string | null
  lastError: string | null
  lastEventType: string | null
}

type OpenHarnessExternalBinding = {
  provider: string
  source_path: string
  source_kind: string
  managed_by: string
  profile_label: string
}

function jsonLiteral(value: unknown): string {
  return JSON.stringify(value)
}

function resolveOpenHarnessActiveProfile(route: OpenCodexBackendRoute): string {
  switch (route.kind) {
    case "codex-subscription":
      return "codex"
    case "claude-subscription":
      return "claude-subscription"
    case "anthropic-compatible-api":
      return "claude-api"
    case "custom-endpoint":
      return route.providerFamily === "anthropic-compatible"
        ? "claude-api"
        : "openai-compatible"
    case "openai-compatible-api":
    default:
      return "openai-compatible"
  }
}

function resolveOpenHarnessApiFormat(route: OpenCodexBackendRoute): "openai" | "anthropic" | null {
  const providerFamily = getOpenCodexBackendProviderFamily(route)
  if (!providerFamily) {
    return null
  }
  return providerFamily === "anthropic-compatible" ? "anthropic" : "openai"
}

function buildOpenHarnessBackendHostScript({
  openharnessSrcPath,
  route,
  workspacePath,
}: {
  openharnessSrcPath: string
  route: OpenCodexBackendRoute
  workspacePath: string
}): string {
  const activeProfile = resolveOpenHarnessActiveProfile(route)
  const args = [
    `cwd=${jsonLiteral(workspacePath)}`,
    `active_profile=${jsonLiteral(activeProfile)}`,
    "permission_mode='default'",
  ]

  if (route.kind !== "codex-subscription" && route.kind !== "claude-subscription") {
    args.push(`model=${jsonLiteral(route.model)}`)
    args.push(`base_url=${jsonLiteral(route.baseUrl)}`)
    args.push(`api_key=${jsonLiteral(route.apiKey)}`)
    const apiFormat = resolveOpenHarnessApiFormat(route)
    if (apiFormat) {
      args.push(`api_format=${jsonLiteral(apiFormat)}`)
    }
  }

  return [
    "import asyncio",
    "import sys",
    `sys.path.insert(0, ${jsonLiteral(openharnessSrcPath)})`,
    "from openharness.ui.backend_host import run_backend_host",
    `asyncio.run(run_backend_host(${args.join(", ")}))`,
  ].join("\n")
}

function resolveExternalBinding(
  route: OpenCodexBackendRoute,
  env: NodeJS.ProcessEnv,
): OpenHarnessExternalBinding | null {
  if (route.kind === "codex-subscription") {
    const codexHome = (env.CODEX_HOME || join(homedir(), ".codex")).trim()
    return {
      provider: "openai_codex",
      source_path: join(codexHome, "auth.json"),
      source_kind: "codex_auth_json",
      managed_by: "codex-cli",
      profile_label: "Codex CLI",
    }
  }

  if (route.kind !== "claude-subscription") {
    return null
  }

  const configuredDir = (env.CLAUDE_CONFIG_DIR || "").trim()
  if (configuredDir) {
    return {
      provider: "anthropic_claude",
      source_path: join(configuredDir, ".credentials.json"),
      source_kind: "claude_credentials_json",
      managed_by: "claude-cli",
      profile_label: "Claude CLI",
    }
  }

  if (process.platform === "darwin") {
    return {
      provider: "anthropic_claude",
      source_path: "keychain:Claude Code-credentials",
      source_kind: "claude_credentials_keychain",
      managed_by: "claude-cli",
      profile_label: "Claude CLI",
    }
  }

  const claudeHome = (env.CLAUDE_HOME || join(homedir(), ".claude")).trim()
  return {
    provider: "anthropic_claude",
    source_path: join(claudeHome, ".credentials.json"),
    source_kind: "claude_credentials_json",
    managed_by: "claude-cli",
    profile_label: "Claude CLI",
  }
}

function materializeExternalBinding({
  configDir,
  route,
  env,
}: {
  configDir: string
  route: OpenCodexBackendRoute
  env: NodeJS.ProcessEnv
}): void {
  const binding = resolveExternalBinding(route, env)
  if (!binding) {
    return
  }

  const credentialsPath = join(configDir, "credentials.json")
  let payload: Record<string, unknown> = {}
  if (existsSync(credentialsPath)) {
    payload = JSON.parse(readFileSync(credentialsPath, "utf8")) as Record<string, unknown>
  }

  const providerEntry =
    typeof payload[binding.provider] === "object" && payload[binding.provider] !== null
      ? { ...(payload[binding.provider] as Record<string, unknown>) }
      : {}

  providerEntry.external_binding = binding
  payload[binding.provider] = providerEntry
  writeFileSync(credentialsPath, JSON.stringify(payload, null, 2), "utf8")
}

export function resolveOpenCodexBackendHostPaths({
  userDataPath,
}: {
  userDataPath: string
}): OpenCodexBackendHostPaths {
  const { appServerHomeDir } = resolveOpenCodexDataPaths(userDataPath)
  return {
    rootDir: appServerHomeDir,
    configDir: join(appServerHomeDir, "openharness-config"),
    dataDir: join(appServerHomeDir, "openharness-data"),
    logsDir: join(appServerHomeDir, "openharness-logs"),
  }
}

export function buildOpenCodexBackendHostLaunchSpec({
  appRoot,
  userDataPath,
  workspacePath,
  env = process.env,
}: {
  appRoot: string
  userDataPath: string
  workspacePath: string
  env?: NodeJS.ProcessEnv
}): OpenCodexBackendHostLaunchSpec {
  const config = readOpenCodexBackendConfig({ userDataPath })
  if (!config) {
    throw new Error("OpenCodex backend host cannot start without a saved backend config")
  }
  if (!openCodexBackendRouteRequiresHost(config)) {
    throw new Error(`OpenCodex backend host launch is not materialized for route kind ${config.kind}`)
  }

  const openharnessRoot = resolve(appRoot, "..", "openharness")
  const openharnessSrcPath = join(openharnessRoot, "src")
  const openharnessBackendHostPath = join(
    openharnessRoot,
    "src",
    "openharness",
    "ui",
    "backend_host.py",
  )
  if (!existsSync(openharnessBackendHostPath)) {
    throw new Error(`OpenHarness backend host is missing at ${openharnessBackendHostPath}`)
  }

  const ownedPaths = resolveOpenCodexBackendHostPaths({ userDataPath })
  for (const dirPath of [ownedPaths.rootDir, ownedPaths.configDir, ownedPaths.dataDir, ownedPaths.logsDir]) {
    mkdirSync(dirPath, { recursive: true })
  }
  materializeExternalBinding({
    configDir: ownedPaths.configDir,
    route: config,
    env,
  })

  const command =
    env.OPENCODEX_OPENHARNESS_PYTHON ||
    (process.platform === "win32" ? "py" : "python3")
  const inlineScript = buildOpenHarnessBackendHostScript({
    openharnessSrcPath,
    route: config,
    workspacePath: resolve(workspacePath),
  })
  const args =
    process.platform === "win32"
      ? ["-3", "-c", inlineScript]
      : ["-c", inlineScript]

  return {
    command,
    args,
    cwd: resolve(openharnessRoot),
    env: {
      ...process.env,
      ...env,
      PYTHONUTF8: "1",
      PYTHONIOENCODING: "utf-8",
      OPENHARNESS_CONFIG_DIR: ownedPaths.configDir,
      OPENHARNESS_DATA_DIR: ownedPaths.dataDir,
      OPENHARNESS_LOGS_DIR: ownedPaths.logsDir,
    },
    inlineScript,
  }
}

class OpenCodexBackendHostSupervisor {
  private child: ChildProcessWithoutNullStreams | null = null
  private state: OpenCodexBackendHostState = {
    status: "stopped",
    pid: null,
    startedAt: null,
    lastError: null,
    lastEventType: null,
  }

  getState(): OpenCodexBackendHostState {
    return { ...this.state }
  }

  async start({
    appRoot,
    userDataPath,
    workspacePath,
  }: {
    appRoot: string
    userDataPath: string
    workspacePath: string
  }): Promise<OpenCodexBackendHostState> {
    const route = readOpenCodexBackendConfig({ userDataPath })
    if (!route) {
      return this.getState()
    }

    if (!openCodexBackendRouteRequiresHost(route)) {
      await this.stop()
      this.state = {
        status: "stopped",
        pid: null,
        startedAt: null,
        lastError: null,
        lastEventType: route.kind,
      }
      return this.getState()
    }

    if (this.child && this.state.status === "ready") {
      return this.getState()
    }

    await this.stop()

    const spec = buildOpenCodexBackendHostLaunchSpec({
      appRoot,
      userDataPath,
      workspacePath,
    })

    this.state = {
      status: "starting",
      pid: null,
      startedAt: new Date().toISOString(),
      lastError: null,
      lastEventType: null,
    }

    this.child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    })
    this.state.pid = this.child.pid ?? null

    const readyPromise = new Promise<OpenCodexBackendHostState>((resolveState) => {
      const stdoutReader = createInterface({ input: this.child!.stdout })
      let settled = false
      const settleReady = (next: OpenCodexBackendHostState) => {
        if (settled) {
          return
        }
        settled = true
        stdoutReader.close()
        resolveState(next)
      }

      stdoutReader.on("line", (line) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith("OHJSON:")) {
          return
        }

        try {
          const event = JSON.parse(trimmed.slice("OHJSON:".length)) as {
            type?: string
            message?: string
          }
          this.state.lastEventType = event.type ?? null
          if (event.type === "ready") {
            this.state.status = "ready"
            settleReady(this.getState())
            return
          }
          if (event.type === "error") {
            this.state.status = "error"
            this.state.lastError = event.message ?? "OpenHarness backend host reported an error"
            settleReady(this.getState())
          }
        } catch (error) {
          this.state.status = "error"
          this.state.lastError =
            error instanceof Error ? error.message : "Failed to parse OpenHarness backend host output"
          settleReady(this.getState())
        }
      })

      this.child!.once("error", (error) => {
        this.state.status = "error"
        this.state.lastError = error.message
        settleReady(this.getState())
      })

      this.child!.once("exit", (code, signal) => {
        if (this.state.status === "starting") {
          this.state.status = code === 0 ? "stopped" : "error"
          this.state.pid = null
          this.state.lastError =
            code === 0
              ? this.state.lastError
              : this.state.lastError || `OpenHarness backend host exited with code ${code ?? "null"} (${signal ?? "no-signal"})`
          settleReady(this.getState())
        }
      })
    })

    this.child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8").trim()
      if (text.length > 0) {
        this.state.lastError = text
      }
    })

    this.child.on("exit", (code, signal) => {
      this.child = null
      if (this.state.status !== "stopped") {
        this.state = {
          ...this.state,
          status: code === 0 ? "stopped" : "error",
          pid: null,
          lastError:
            code === 0
              ? this.state.lastError
              : this.state.lastError || `OpenHarness backend host exited with code ${code ?? "null"} (${signal ?? "no-signal"})`,
        }
      }
    })

    return await Promise.race([
      readyPromise,
      new Promise<OpenCodexBackendHostState>((resolveState) => {
        setTimeout(() => {
          if (this.state.status === "starting") {
            this.state.status = "error"
            this.state.lastError = "OpenHarness backend host did not emit a ready event in time"
          }
          resolveState(this.getState())
        }, 15000)
      }),
    ])
  }

  async stop(): Promise<void> {
    if (!this.child) {
      this.state = {
        status: "stopped",
        pid: null,
        startedAt: null,
        lastError: this.state.lastError,
        lastEventType: this.state.lastEventType,
      }
      return
    }

    const activeChild = this.child
    this.child = null
    activeChild.kill()
    this.state = {
      status: "stopped",
      pid: null,
      startedAt: null,
      lastError: this.state.lastError,
      lastEventType: this.state.lastEventType,
    }
  }
}

let backendHostSupervisor: OpenCodexBackendHostSupervisor | null = null

function getSupervisor(): OpenCodexBackendHostSupervisor {
  if (!backendHostSupervisor) {
    backendHostSupervisor = new OpenCodexBackendHostSupervisor()
  }
  return backendHostSupervisor
}

export function getOpenCodexBackendHostState(): OpenCodexBackendHostState {
  return getSupervisor().getState()
}

export async function maybeStartOpenCodexBackendHost({
  appRoot,
  userDataPath,
  workspacePath,
}: {
  appRoot: string
  userDataPath: string
  workspacePath: string
}): Promise<OpenCodexBackendHostState> {
  if (!readOpenCodexBackendConfig({ userDataPath })) {
    return getOpenCodexBackendHostState()
  }
  return await getSupervisor().start({ appRoot, userDataPath, workspacePath })
}

export async function restartOpenCodexBackendHost({
  appRoot,
  userDataPath,
  workspacePath,
}: {
  appRoot: string
  userDataPath: string
  workspacePath: string
}): Promise<OpenCodexBackendHostState> {
  const supervisor = getSupervisor()
  await supervisor.stop()
  return await supervisor.start({ appRoot, userDataPath, workspacePath })
}

export async function stopOpenCodexBackendHost(): Promise<void> {
  await getSupervisor().stop()
}

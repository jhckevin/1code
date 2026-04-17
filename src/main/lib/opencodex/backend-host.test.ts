import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  buildOpenCodexBackendHostLaunchSpec,
  resolveOpenCodexBackendHostPaths,
  restartOpenCodexBackendHost,
} from "./backend-host"
import { saveOpenCodexBackendConfig } from "./backend-config"

let tempDirs: string[] = []

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
  tempDirs = []
})

describe("OpenCodex backend host supervisor", () => {
  test("resolves owned OpenHarness config/data/log directories under OpenCodex state", () => {
    const userDataPath = mkdtempSync(join(process.cwd(), "tmp-opencodex-backend-host-"))
    tempDirs.push(userDataPath)

    const paths = resolveOpenCodexBackendHostPaths({ userDataPath })

    expect(paths.configDir.endsWith(join("opencodex", "app-server-home", "openharness-config"))).toBe(true)
    expect(paths.dataDir.endsWith(join("opencodex", "app-server-home", "openharness-data"))).toBe(true)
    expect(paths.logsDir.endsWith(join("opencodex", "app-server-home", "openharness-logs"))).toBe(true)
  })

  test("builds a launch spec from the saved api-backed route and prefers utf-8 python mode", () => {
    const userDataPath = mkdtempSync(join(process.cwd(), "tmp-opencodex-backend-host-"))
    tempDirs.push(userDataPath)

    saveOpenCodexBackendConfig({
      userDataPath,
      config: {
        kind: "openai-compatible-api",
        authSource: "api-key",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.2",
        apiKey: "sk-opencodex-test",
      },
    })

    const appRoot = process.cwd()
    const spec = buildOpenCodexBackendHostLaunchSpec({
      appRoot,
      userDataPath,
      workspacePath: process.cwd(),
      env: { OPENCODEX_OPENHARNESS_PYTHON: "py" },
    })

    expect(spec.command).toBe("py")
    expect(spec.args).toContain("-3")
    expect(spec.args).toContain("-c")
    expect(spec.inlineScript).toContain("run_backend_host")
    expect(spec.inlineScript).toContain('active_profile="openai-compatible"')
    expect(spec.inlineScript).toContain("\"gpt-5.2\"")
    expect(spec.inlineScript).toContain("\"https://api.openai.com/v1\"")
    expect(spec.inlineScript).toContain("\"sk-opencodex-test\"")
    expect(spec.env.PYTHONUTF8).toBe("1")
    expect(spec.env.OPENHARNESS_CONFIG_DIR?.includes("openharness-config")).toBe(true)
  })

  test("builds a launch spec for the codex subscription route using the codex profile bridge", () => {
    const userDataPath = mkdtempSync(join(process.cwd(), "tmp-opencodex-backend-host-"))
    tempDirs.push(userDataPath)

    saveOpenCodexBackendConfig({
      userDataPath,
      config: {
        kind: "codex-subscription",
        authSource: "codex-local-auth",
      },
    })

    const spec = buildOpenCodexBackendHostLaunchSpec({
      appRoot: process.cwd(),
      userDataPath,
      workspacePath: process.cwd(),
    })

    const credentialsPath = spec.env.OPENHARNESS_CONFIG_DIR
      ? join(spec.env.OPENHARNESS_CONFIG_DIR, "credentials.json")
      : ""

    expect(spec.inlineScript).toContain("run_backend_host")
    expect(spec.inlineScript).toContain('active_profile="codex"')
    expect(spec.inlineScript).not.toContain('"sk-')
    expect(spec.inlineScript).not.toContain('"https://')
    expect(spec.inlineScript).not.toContain("run_repl")
    expect(credentialsPath.length > 0 && existsSync(credentialsPath)).toBe(true)
    expect(JSON.parse(readFileSync(credentialsPath, "utf8"))).toMatchObject({
      openai_codex: {
        external_binding: {
          provider: "openai_codex",
          source_kind: "codex_auth_json",
          managed_by: "codex-cli",
        },
      },
    })
  })

  test("builds a launch spec for the claude subscription route using the claude profile bridge", () => {
    const userDataPath = mkdtempSync(join(process.cwd(), "tmp-opencodex-backend-host-"))
    tempDirs.push(userDataPath)

    saveOpenCodexBackendConfig({
      userDataPath,
      config: {
        kind: "claude-subscription",
        authSource: "claude-local-auth",
      },
    })

    const spec = buildOpenCodexBackendHostLaunchSpec({
      appRoot: process.cwd(),
      userDataPath,
      workspacePath: process.cwd(),
    })

    const credentialsPath = spec.env.OPENHARNESS_CONFIG_DIR
      ? join(spec.env.OPENHARNESS_CONFIG_DIR, "credentials.json")
      : ""

    expect(spec.inlineScript).toContain("run_backend_host")
    expect(spec.inlineScript).toContain('active_profile="claude-subscription"')
    expect(spec.inlineScript).not.toContain('"sk-ant-')
    expect(spec.inlineScript).not.toContain("run_repl")
    expect(credentialsPath.length > 0 && existsSync(credentialsPath)).toBe(true)
    expect(JSON.parse(readFileSync(credentialsPath, "utf8"))).toMatchObject({
      anthropic_claude: {
        external_binding: {
          provider: "anthropic_claude",
          managed_by: "claude-cli",
        },
      },
    })
  })

  test("reports backend process launch failures through host state", async () => {
    const userDataPath = mkdtempSync(join(process.cwd(), "tmp-opencodex-backend-host-"))
    tempDirs.push(userDataPath)

    saveOpenCodexBackendConfig({
      userDataPath,
      config: {
        kind: "codex-subscription",
        authSource: "codex-local-auth",
      },
    })

    const previousPython = process.env.OPENCODEX_OPENHARNESS_PYTHON
    process.env.OPENCODEX_OPENHARNESS_PYTHON = "opencodex-python-does-not-exist"

    try {
      const state = await restartOpenCodexBackendHost({
        appRoot: process.cwd(),
        userDataPath,
        workspacePath: process.cwd(),
      })

      expect(state.status).toBe("error")
      expect(state.lastError).toContain("opencodex-python-does-not-exist")
    } finally {
      if (previousPython === undefined) {
        delete process.env.OPENCODEX_OPENHARNESS_PYTHON
      } else {
        process.env.OPENCODEX_OPENHARNESS_PYTHON = previousPython
      }
    }
  })
})

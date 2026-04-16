import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  buildOpenCodexBackendHostLaunchSpec,
  resolveOpenCodexBackendHostPaths,
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

  test("builds a launch spec from the saved backend config and prefers utf-8 python mode", () => {
    const userDataPath = mkdtempSync(join(process.cwd(), "tmp-opencodex-backend-host-"))
    tempDirs.push(userDataPath)

    saveOpenCodexBackendConfig({
      userDataPath,
      config: {
        providerFamily: "openai-compatible",
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
    expect(spec.inlineScript).toContain("run_repl")
    expect(spec.inlineScript).toContain("\"gpt-5.2\"")
    expect(spec.inlineScript).toContain("\"https://api.openai.com/v1\"")
    expect(spec.inlineScript).toContain("\"sk-opencodex-test\"")
    expect(spec.env.PYTHONUTF8).toBe("1")
    expect(spec.env.OPENHARNESS_CONFIG_DIR.includes("openharness-config")).toBe(true)
  })
})

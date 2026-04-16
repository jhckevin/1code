import { describe, expect, test } from "bun:test"
import {
  bridgeOpenCodexBackendConfig,
  getOpenCodexBackendTemplate,
} from "./opencodex-backend-config"

describe("OpenCodex backend config bridge", () => {
  test("maps OpenAI-compatible backend config onto the codex runtime seam", () => {
    const bridge = bridgeOpenCodexBackendConfig({
      providerFamily: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.2",
      apiKey: "sk-openai-test",
    })

    expect(bridge.billingMethod).toBe("codex-api-key")
    expect(bridge.codexOnboardingCompleted).toBe(true)
    expect(bridge.codexApiKey).toBe("sk-openai-test")
    expect(bridge.lastSelectedAgentId).toBe("codex")
  })

  test("maps Anthropic-compatible backend config onto the custom runtime seam", () => {
    const bridge = bridgeOpenCodexBackendConfig({
      providerFamily: "anthropic-compatible",
      baseUrl: "https://api.anthropic.com",
      model: "claude-sonnet-4-6",
      apiKey: "sk-ant-test",
    })

    expect(bridge.billingMethod).toBe("custom-model")
    expect(bridge.apiKeyOnboardingCompleted).toBe(true)
    expect(bridge.customClaudeConfig).toEqual({
      model: "claude-sonnet-4-6",
      token: "sk-ant-test",
      baseUrl: "https://api.anthropic.com",
    })
    expect(bridge.lastSelectedAgentId).toBe("claude-code")
  })

  test("provides stable provider templates for backend setup", () => {
    expect(getOpenCodexBackendTemplate("openai-compatible")).toEqual({
      providerFamily: "openai-compatible",
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-5.2",
      apiKey: "",
    })
    expect(getOpenCodexBackendTemplate("custom")).toEqual({
      providerFamily: "custom",
      baseUrl: "http://127.0.0.1:8000/v1",
      model: "opencodex-default",
      apiKey: "",
    })
  })
})

import type {
  BillingMethod,
  CodexOnboardingAuthMethod,
  CustomClaudeConfig,
  OpenCodexBackendConfig,
  OpenCodexBackendProviderFamily,
} from "../../lib/atoms"

export type OpenCodexBackendRuntimeBridge = {
  billingMethod: BillingMethod
  customClaudeConfig: CustomClaudeConfig
  apiKeyOnboardingCompleted: boolean
  codexOnboardingCompleted: boolean
  codexOnboardingAuthMethod: CodexOnboardingAuthMethod
  codexApiKey: string
  lastSelectedAgentId: "claude-code" | "codex"
}

export function getOpenCodexBackendTemplate(
  providerFamily: OpenCodexBackendProviderFamily,
): OpenCodexBackendConfig {
  switch (providerFamily) {
    case "anthropic-compatible":
      return {
        providerFamily,
        baseUrl: "https://api.anthropic.com",
        model: "claude-sonnet-4-6",
        apiKey: "",
      }
    case "custom":
      return {
        providerFamily,
        baseUrl: "http://127.0.0.1:8000/v1",
        model: "opencodex-default",
        apiKey: "",
      }
    default:
      return {
        providerFamily,
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-5.2",
        apiKey: "",
      }
  }
}

export function bridgeOpenCodexBackendConfig(
  config: OpenCodexBackendConfig,
): OpenCodexBackendRuntimeBridge {
  if (config.providerFamily === "openai-compatible") {
    return {
      billingMethod: "codex-api-key",
      customClaudeConfig: {
        model: "",
        token: "",
        baseUrl: "",
      },
      apiKeyOnboardingCompleted: false,
      codexOnboardingCompleted: true,
      codexOnboardingAuthMethod: "api_key",
      codexApiKey: config.apiKey,
      lastSelectedAgentId: "codex",
    }
  }

  return {
    billingMethod: "custom-model",
    customClaudeConfig: {
      model: config.model,
      token: config.apiKey,
      baseUrl: config.baseUrl,
    },
    apiKeyOnboardingCompleted: true,
    codexOnboardingCompleted: false,
    codexOnboardingAuthMethod: "api_key",
    codexApiKey: "",
    lastSelectedAgentId: "claude-code",
  }
}

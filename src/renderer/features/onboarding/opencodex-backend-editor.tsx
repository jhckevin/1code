"use client"

import { Check, KeyRound, RotateCw, ServerCog } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Input } from "../../components/ui/input"
import { Label } from "../../components/ui/label"
import { Logo } from "../../components/ui/logo"
import type {
  OpenCodexBackendConfig,
  OpenCodexBackendProviderFamily,
} from "../../lib/atoms"
import { normalizeOpenCodexBackendConfig } from "../../lib/atoms"
import { cn } from "../../lib/utils"
import { getOpenCodexBackendTemplate } from "./opencodex-backend-config"

const PROVIDER_OPTIONS = [
  {
    id: "openai-compatible",
    title: "OpenAI-Compatible",
    description: "Route OpenCodex through an OpenAI-compatible API target.",
  },
  {
    id: "anthropic-compatible",
    title: "Anthropic-Compatible",
    description: "Route OpenCodex through an Anthropic-compatible API target.",
  },
  {
    id: "custom",
    title: "Custom Endpoint",
    description:
      "Route OpenCodex through a custom local or remote OpenAI-style endpoint.",
  },
] as const satisfies ReadonlyArray<{
  id: OpenCodexBackendProviderFamily
  title: string
  description: string
}>

type OpenCodexBackendEditorVariant = "onboarding" | "settings"

type OpenCodexBackendEditorProps = {
  variant: OpenCodexBackendEditorVariant
  initialConfig: OpenCodexBackendConfig
  onConfigured?: (config: OpenCodexBackendConfig) => Promise<void> | void
}

function getBackendStatusLabel(
  hostState: OpenCodexBackendHostState | null,
): string {
  switch (hostState?.status) {
    case "ready":
      return "Running"
    case "starting":
      return "Starting"
    case "error":
      return "Error"
    default:
      return "Stopped"
  }
}

function getBackendStatusVariant(
  hostState: OpenCodexBackendHostState | null,
): "secondary" | "outline" | "destructive" {
  switch (hostState?.status) {
    case "ready":
      return "secondary"
    case "error":
      return "destructive"
    default:
      return "outline"
  }
}

export function OpenCodexBackendEditor({
  variant,
  initialConfig,
  onConfigured,
}: OpenCodexBackendEditorProps) {
  const [draft, setDraft] = useState(initialConfig)
  const [error, setError] = useState<string | null>(null)
  const [hostState, setHostState] = useState<OpenCodexBackendHostState | null>(
    null,
  )
  const [isRefreshingHostState, setIsRefreshingHostState] = useState(false)
  const [isApplyingConfig, setIsApplyingConfig] = useState(false)
  const [isRestartingHost, setIsRestartingHost] = useState(false)

  useEffect(() => {
    setDraft(initialConfig)
  }, [initialConfig])

  const normalizedConfig = useMemo(
    () => normalizeOpenCodexBackendConfig(draft),
    [draft],
  )

  const refreshHostState = async () => {
    setIsRefreshingHostState(true)
    try {
      const nextHostState = await window.desktopApi.getBackendHostState()
      setHostState(nextHostState)
      return nextHostState
    } catch (hostError) {
      setError(
        hostError instanceof Error
          ? hostError.message
          : "Failed to read local backend host state.",
      )
      return null
    } finally {
      setIsRefreshingHostState(false)
    }
  }

  useEffect(() => {
    void refreshHostState()
  }, [])

  const updateField = (
    field: keyof Pick<OpenCodexBackendConfig, "baseUrl" | "model" | "apiKey">,
    value: string,
  ) => {
    setError(null)
    setDraft((current) => ({
      ...current,
      [field]: value,
    }))
  }

  const updateProvider = (providerFamily: OpenCodexBackendProviderFamily) => {
    setError(null)
    setDraft((current) => ({
      ...getOpenCodexBackendTemplate(providerFamily),
      apiKey:
        current.providerFamily === providerFamily ? current.apiKey : "",
    }))
  }

  const applyBackendConfig = async () => {
    if (!normalizedConfig) {
      setError(
        "Complete the backend base URL, model, and credential before applying the local backend route.",
      )
      return
    }

    setIsApplyingConfig(true)
    setError(null)

    try {
      await window.desktopApi.saveOpenCodexBackendConfig(normalizedConfig)
      const nextHostState = await window.desktopApi.restartBackendHost()
      setHostState(nextHostState)

      if (nextHostState.status !== "ready") {
        setError(
          nextHostState.lastError ||
            "OpenCodex could not start the local backend host.",
        )
        return
      }

      await onConfigured?.(normalizedConfig)
    } catch (applyError) {
      setError(
        applyError instanceof Error
          ? applyError.message
          : "OpenCodex failed to save or restart the local backend host.",
      )
    } finally {
      setIsApplyingConfig(false)
    }
  }

  const restartBackendHost = async () => {
    setIsRestartingHost(true)
    setError(null)

    try {
      const nextHostState = await window.desktopApi.restartBackendHost()
      setHostState(nextHostState)

      if (nextHostState.status !== "ready") {
        setError(
          nextHostState.lastError ||
            "OpenCodex could not restart the local backend host.",
        )
        return
      }
    } catch (restartError) {
      setError(
        restartError instanceof Error
          ? restartError.message
          : "Failed to restart the local backend host.",
      )
    } finally {
      setIsRestartingHost(false)
    }
  }

  const statusLabel = getBackendStatusLabel(hostState)
  const statusVariant = getBackendStatusVariant(hostState)
  const primaryLabel =
    variant === "onboarding" ? "Continue to Workspace" : "Save Backend"

  const cardClassName =
    variant === "onboarding"
      ? "space-y-5 rounded-2xl border border-border bg-card p-6 shadow-sm"
      : "space-y-5 rounded-2xl border border-border bg-card p-5 shadow-sm"

  return (
    <div className={cardClassName}>
      {variant === "onboarding" && (
        <div className="space-y-4 text-center">
          <div className="mx-auto flex w-max items-center gap-2 rounded-full border border-border px-3 py-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary">
              <Logo className="h-5 w-5" fill="white" />
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-foreground text-background">
              <ServerCog className="h-5 w-5" />
            </div>
          </div>
          <div className="space-y-2">
            <h1 className="text-xl font-semibold tracking-tight">
              Configure OpenCodex Backend
            </h1>
            <p className="mx-auto max-w-[460px] text-sm leading-6 text-muted-foreground">
              Configure the local backend once, keep the APP-Server hidden behind
              the desktop shell, and enter the workspace without any browser
              login flow.
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-3">
        {PROVIDER_OPTIONS.map((option) => {
          const selected = draft.providerFamily === option.id
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => updateProvider(option.id)}
              className={cn(
                "relative rounded-2xl border p-4 text-left transition-colors",
                selected
                  ? "border-primary bg-primary/5 shadow-sm"
                  : "border-border bg-card hover:border-foreground/20",
              )}
            >
              {selected && (
                <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Check className="h-3 w-3" />
                </span>
              )}
              <p className="text-sm font-medium">{option.title}</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {option.description}
              </p>
            </button>
          )
        })}
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${variant}-backend-base-url`}>Base URL</Label>
        <Input
          id={`${variant}-backend-base-url`}
          value={draft.baseUrl}
          onChange={(event) => updateField("baseUrl", event.target.value)}
          placeholder="https://api.openai.com/v1"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${variant}-backend-model`}>Model</Label>
        <Input
          id={`${variant}-backend-model`}
          value={draft.model}
          onChange={(event) => updateField("model", event.target.value)}
          placeholder="gpt-5.2"
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${variant}-backend-api-key`}>Credential</Label>
        <div className="relative">
          <Input
            id={`${variant}-backend-api-key`}
            type="password"
            value={draft.apiKey}
            onChange={(event) => updateField("apiKey", event.target.value)}
            placeholder={
              draft.providerFamily === "anthropic-compatible"
                ? "sk-ant-..."
                : "sk-..."
            }
            className="pr-10 font-mono"
          />
          <KeyRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          The frontend owns this setup. End users never need to see OpenHarness
          terminals, Codex login windows, or Claude CLI prompts.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-background/70 p-4">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-sm font-medium">Backend Host</div>
            <div className="text-xs text-muted-foreground">
              APP-Server lifecycle stays inside the desktop shell.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={statusVariant} className="text-xs">
              {statusLabel}
            </Badge>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void refreshHostState()}
              disabled={isRefreshingHostState}
            >
              {isRefreshingHostState ? "Refreshing..." : "Refresh Status"}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void restartBackendHost()}
              disabled={isRestartingHost}
            >
              <RotateCw className="mr-1 h-3 w-3" />
              {isRestartingHost ? "Restarting..." : "Restart Host"}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-2 text-xs text-muted-foreground md:grid-cols-2">
          <div className="flex items-center justify-between gap-3">
            <span>PID</span>
            <span className="font-mono text-foreground/80">
              {hostState?.pid ?? "N/A"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span>Last event</span>
            <span className="max-w-[220px] truncate font-mono text-foreground/80">
              {hostState?.lastEventType || "N/A"}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 md:col-span-2">
            <span>Started</span>
            <span className="max-w-[320px] truncate font-mono text-foreground/80">
              {hostState?.startedAt || "N/A"}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex items-center justify-between gap-4">
        <p className="text-xs leading-5 text-muted-foreground">
          {variant === "onboarding"
            ? "OpenCodex opens the workspace only after a valid local backend route exists."
            : "Saving the backend applies the route immediately and restarts the hidden APP-Server."}
        </p>
        <Button
          type="button"
          onClick={() => void applyBackendConfig()}
          disabled={!normalizedConfig || isApplyingConfig}
        >
          {isApplyingConfig
            ? variant === "onboarding"
              ? "Starting Local Backend..."
              : "Saving Backend..."
            : primaryLabel}
        </Button>
      </div>
    </div>
  )
}

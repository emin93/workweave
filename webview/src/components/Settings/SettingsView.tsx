import React, { useState, useEffect } from "react";
import { usePlanStore } from "../../stores/planStore";
import { postMessage } from "../../hooks/useVSCode";
import {
  ArrowLeft,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
  Sparkles,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";
import type { AIConfig, AIProviderType } from "../../../../src/types";

export function SettingsView() {
  const { config, setView, aiTestResult } = usePlanStore();

  const [workdayHours, setWorkdayHours] = useState(
    config ? config.workdayMinutes / 60 : 8
  );
  const [startTime, setStartTime] = useState(config?.startTime ?? "09:00");
  const [autoSync, setAutoSync] = useState(config?.autoSync ?? true);

  const [aiProvider, setAiProvider] = useState<AIProviderType>(
    config?.ai?.provider ?? "cursor"
  );
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiBaseUrl, setAiBaseUrl] = useState(
    config?.ai?.openai?.baseUrl ?? ""
  );
  const [aiModel, setAiModel] = useState(
    config?.ai?.openai?.model ?? config?.ai?.ollama?.model ?? ""
  );
  const [ollamaUrl, setOllamaUrl] = useState(
    config?.ai?.ollama?.baseUrl ?? ""
  );
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (config) {
      setWorkdayHours(config.workdayMinutes / 60);
      setStartTime(config.startTime);
      setAutoSync(config.autoSync);
      setAiProvider(config.ai?.provider ?? "cursor");
      setAiBaseUrl(config.ai?.openai?.baseUrl ?? "");
      setAiModel(
        config.ai?.openai?.model ?? config.ai?.ollama?.model ?? ""
      );
      setOllamaUrl(config.ai?.ollama?.baseUrl ?? "");
    }
  }, [config]);

  useEffect(() => {
    if (aiTestResult) setTesting(false);
  }, [aiTestResult]);

  const buildAIConfig = (): AIConfig => ({
    provider: aiProvider,
    openai:
      aiProvider === "openai"
        ? {
            baseUrl: aiBaseUrl || undefined,
            model: aiModel || undefined,
          }
        : undefined,
    ollama:
      aiProvider === "ollama"
        ? {
            baseUrl: ollamaUrl || undefined,
            model: aiModel || undefined,
          }
        : undefined,
  });

  const save = () => {
    postMessage({ type: "action:setAIConfig", ai: buildAIConfig() });

    if (aiProvider === "openai" && aiApiKey) {
      postMessage({ type: "action:setAIKey", apiKey: aiApiKey });
    }

    postMessage({
      type: "onboarding:configure",
      config: {
        workdayMinutes: workdayHours * 60,
        startTime,
        autoSync,
      },
    });
    setView("plan");
  };

  const testConnection = () => {
    setTesting(true);
    postMessage({
      type: "action:testAI",
      ai: buildAIConfig(),
      apiKey: aiProvider === "openai" && aiApiKey ? aiApiKey : undefined,
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2">
        <button className="btn-ghost" onClick={() => setView("plan")}>
          <ArrowLeft size={14} />
        </button>
        <h2 className="text-sm font-semibold">Settings</h2>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-medium block mb-1">
            Working hours per day
          </label>
          <input
            type="number"
            className="input"
            value={workdayHours}
            onChange={(e) => setWorkdayHours(Number(e.target.value))}
            min={1}
            max={16}
          />
        </div>

        <div>
          <label className="text-xs font-medium block mb-1">Start time</label>
          <input
            type="time"
            className="input"
            value={startTime}
            onChange={(e) => setStartTime(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between">
          <label className="text-xs font-medium">Auto-sync on IDE open</label>
          <button
            className="bg-transparent border-none cursor-pointer"
            onClick={() => setAutoSync(!autoSync)}
          >
            {autoSync ? (
              <ToggleRight size={20} className="text-vscode-link" />
            ) : (
              <ToggleLeft size={20} className="text-vscode-descFg" />
            )}
          </button>
        </div>
      </div>

      <div className="border-t border-vscode-border pt-3 space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-yellow-400" />
          <span className="text-xs font-semibold">AI Synthesis</span>
        </div>

        <div>
          <label className="text-xs font-medium block mb-1">Provider</label>
          <select
            className="input"
            value={aiProvider}
            onChange={(e) =>
              setAiProvider(e.target.value as AIProviderType)
            }
          >
            <option value="cursor">Cursor Chat</option>
            <option value="openai">API Key (OpenAI or compatible)</option>
            <option value="ollama">Ollama (local)</option>
          </select>
        </div>

        {aiProvider === "openai" && (
          <>
            <div>
              <label className="text-xs font-medium block mb-1">
                API Key
              </label>
              <input
                type="password"
                className="input"
                value={aiApiKey}
                onChange={(e) => setAiApiKey(e.target.value)}
                placeholder="sk-... (leave empty to keep existing)"
              />
              <p className="text-[10px] text-vscode-descFg mt-0.5">
                Stored securely in your system keychain
              </p>
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                Base URL
              </label>
              <input
                type="text"
                className="input"
                value={aiBaseUrl}
                onChange={(e) => setAiBaseUrl(e.target.value)}
                placeholder="https://api.openai.com (default)"
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                Model
              </label>
              <input
                type="text"
                className="input"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="gpt-4o-mini (default)"
              />
            </div>
          </>
        )}

        {aiProvider === "ollama" && (
          <>
            <div>
              <label className="text-xs font-medium block mb-1">
                Ollama URL
              </label>
              <input
                type="text"
                className="input"
                value={ollamaUrl}
                onChange={(e) => setOllamaUrl(e.target.value)}
                placeholder="http://localhost:11434 (default)"
              />
            </div>

            <div>
              <label className="text-xs font-medium block mb-1">
                Model
              </label>
              <input
                type="text"
                className="input"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="llama3.2 (default)"
              />
            </div>
          </>
        )}

        {aiProvider !== "cursor" && (
          <>
            <button
              className="btn-secondary w-full flex items-center justify-center gap-1"
              onClick={testConnection}
              disabled={testing}
            >
              {testing ? (
                <>
                  <Loader2 size={12} className="animate-spin" />
                  Testing...
                </>
              ) : (
                "Test Connection"
              )}
            </button>

            {aiTestResult && !testing && (
              <div
                className={`flex items-center gap-2 text-xs p-2 rounded ${
                  aiTestResult.success
                    ? "bg-green-500/10 text-green-400"
                    : "bg-red-500/10 text-red-400"
                }`}
              >
                {aiTestResult.success ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <XCircle size={14} />
                )}
                <span>{aiTestResult.message}</span>
              </div>
            )}
          </>
        )}

        <p className="text-[10px] text-vscode-descFg">
          AI analyzes your work items to produce smarter grouping,
          prioritization, and summaries. Falls back to rule-based synthesis
          if the AI call fails.
        </p>
      </div>

      <div className="space-y-2">
        <button className="btn-primary w-full" onClick={save}>
          Save Settings
        </button>

        <button
          className="btn-secondary w-full flex items-center justify-center gap-1"
          onClick={() => postMessage({ type: "action:resetOnboarding" })}
        >
          <RotateCcw size={12} />
          Reset Onboarding
        </button>
      </div>

      {config && (
        <div className="text-[10px] text-vscode-descFg space-y-1 pt-2 border-t border-vscode-border">
          <div>
            Enabled connectors:{" "}
            {config.enabledConnectors
              .filter((c) => c.enabled)
              .map((c) => c.id)
              .join(", ") || "none"}
          </div>
          <div>AI provider: {config.ai?.provider ?? "cursor"}</div>
          <div>Onboarding: {config.onboardingState}</div>
        </div>
      )}
    </div>
  );
}

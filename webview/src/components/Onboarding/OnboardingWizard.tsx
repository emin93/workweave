import React, { useState, useEffect } from "react";
import { usePlanStore } from "../../stores/planStore";
import { postMessage } from "../../hooks/useVSCode";
import {
  Zap,
  ToggleLeft,
  ToggleRight,
  CheckCircle2,
  Loader2,
  Github,
  ListOrdered,
  MessageSquare,
  ExternalLink,
  AlertTriangle,
  KeyRound,
  Sparkles,
  MessageCircle,
  Cpu,
  XCircle,
} from "lucide-react";
import type { ConnectorInfo, AIProviderType, AIConfig } from "../../../../src/types";

const CONNECTOR_ICONS: Record<string, React.ReactNode> = {
  github: <Github size={20} />,
  linear: <ListOrdered size={20} />,
  slack: <MessageSquare size={20} />,
};

export function OnboardingWizard() {
  const { onboardingStep } = usePlanStore();

  switch (onboardingStep) {
    case "not_started":
    case "detecting":
      return <WelcomeStep />;
    case "selecting":
      return <SelectStep />;
    case "ai_setup":
      return <AISetupStep />;
    case "configuring":
      return <ConfigureStep />;
    case "validating":
      return <ValidateStep />;
    case "complete":
      return null;
    default:
      return <WelcomeStep />;
  }
}

function ConnectorCard({
  connector,
  selected,
  onToggle,
  showSetup,
}: {
  connector: ConnectorInfo;
  selected: boolean;
  onToggle: () => void;
  showSetup?: boolean;
}) {
  const [setupExpanded, setSetupExpanded] = useState(false);
  const isAvailable = connector.status.available;

  return (
    <div
      className={`card transition-colors ${selected ? "border-vscode-link" : ""}`}
    >
      <button
        className="w-full text-left flex items-center gap-3 bg-transparent border-none cursor-pointer p-0"
        onClick={onToggle}
      >
        <span className={isAvailable ? "text-vscode-link" : "text-vscode-descFg"}>
          {CONNECTOR_ICONS[connector.id] ?? <Zap size={20} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">{connector.name}</span>
            {isAvailable ? (
              <span className="text-vscode-success text-[10px]">Ready</span>
            ) : (
              <span className="text-vscode-warning text-[10px]">Needs setup</span>
            )}
          </div>
          <div className="text-[10px] text-vscode-descFg truncate">
            {connector.capabilities.map((c) => c.description).join(", ")}
          </div>
        </div>
        {isAvailable ? (
          selected ? (
            <ToggleRight size={20} className="text-vscode-link shrink-0" />
          ) : (
            <ToggleLeft size={20} className="text-vscode-descFg shrink-0" />
          )
        ) : null}
      </button>

      {!isAvailable && showSetup && "reason" in connector.status && (
        <div className="mt-2 pt-2 border-t border-vscode-border">
          <button
            className="text-[10px] text-vscode-link bg-transparent border-none cursor-pointer p-0 flex items-center gap-1"
            onClick={(e) => {
              e.stopPropagation();
              setSetupExpanded(!setupExpanded);
            }}
          >
            <AlertTriangle size={10} />
            {setupExpanded ? "Hide setup instructions" : "How to set up"}
          </button>
          {setupExpanded && (
            <div className="mt-1.5 text-[10px] text-vscode-descFg space-y-1">
              <div className="font-medium text-vscode-fg">
                {connector.status.reason}
              </div>
              <div className="whitespace-pre-wrap leading-relaxed">
                {connector.status.setupInstructions}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function WelcomeStep() {
  const { detectedConnectors } = usePlanStore();
  const hasConnectors = detectedConnectors.length > 0;
  const availableCount = detectedConnectors.filter(
    (c) => c.status.available
  ).length;

  return (
    <div className="p-4 space-y-4">
      <div className="text-center space-y-3 py-4">
        <div className="flex justify-center">
          <Zap size={32} className="text-vscode-link" />
        </div>
        <h2 className="text-base font-semibold">Workday Synthesizer</h2>
        <p className="text-xs text-vscode-descFg leading-relaxed">
          Turn scattered signals from GitHub, Linear, and Slack into a focused,
          prioritized workday plan with one-click execution.
        </p>
      </div>

      {hasConnectors ? (
        <div className="space-y-2">
          <p className="text-xs font-medium">Detected sources:</p>
          {detectedConnectors.map((c) => (
            <ConnectorCard
              key={c.id}
              connector={c}
              selected={c.status.available}
              onToggle={() => {}}
              showSetup
            />
          ))}
        </div>
      ) : (
        <div className="card text-center py-4">
          <Loader2
            size={16}
            className="animate-spin mx-auto mb-2 text-vscode-descFg"
          />
          <p className="text-xs text-vscode-descFg">
            Detecting your environment...
          </p>
        </div>
      )}

      <button
        className="btn-primary w-full"
        onClick={() =>
          postMessage({
            type: "onboarding:selectConnectors",
            connectorIds: detectedConnectors
              .filter((c) => c.status.available)
              .map((c) => c.id),
          })
        }
        disabled={!hasConnectors || availableCount === 0}
      >
        {availableCount > 0
          ? `Continue with ${availableCount} source${availableCount !== 1 ? "s" : ""}`
          : "No sources available — set up at least one above"}
      </button>
    </div>
  );
}

function SelectStep() {
  const { detectedConnectors } = usePlanStore();
  const [selected, setSelected] = useState<Set<string>>(
    new Set(
      detectedConnectors.filter((c) => c.status.available).map((c) => c.id)
    )
  );

  const toggle = (id: string) => {
    const connector = detectedConnectors.find((c) => c.id === id);
    if (!connector?.status.available) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">Select Connectors</h2>
        <p className="text-xs text-vscode-descFg">
          Choose which sources to include in your workday synthesis.
        </p>
      </div>

      <div className="space-y-2">
        {detectedConnectors.map((c) => (
          <ConnectorCard
            key={c.id}
            connector={c}
            selected={selected.has(c.id)}
            onToggle={() => toggle(c.id)}
            showSetup
          />
        ))}
      </div>

      <button
        className="btn-primary w-full"
        onClick={() =>
          postMessage({
            type: "onboarding:selectConnectors",
            connectorIds: Array.from(selected),
          })
        }
        disabled={selected.size === 0}
      >
        Continue with {selected.size} source{selected.size !== 1 ? "s" : ""}
      </button>
    </div>
  );
}

const AI_PROVIDERS: {
  id: AIProviderType;
  name: string;
  description: string;
  icon: React.ReactNode;
  needsConfig: boolean;
}[] = [
  {
    id: "cursor",
    name: "Cursor Chat",
    description: "Zero config — uses Cursor's built-in AI to synthesize your workday",
    icon: <MessageCircle size={20} />,
    needsConfig: false,
  },
  {
    id: "openai",
    name: "API Key",
    description: "OpenAI or any compatible API (Anthropic, Groq, etc.)",
    icon: <KeyRound size={20} />,
    needsConfig: true,
  },
  {
    id: "ollama",
    name: "Ollama",
    description: "Run locally with Ollama — fully private, no API key needed",
    icon: <Cpu size={20} />,
    needsConfig: true,
  },
];

function AISetupStep() {
  const { aiTestResult } = usePlanStore();

  const [provider, setProvider] = useState<AIProviderType>("cursor");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [model, setModel] = useState("");
  const [ollamaUrl, setOllamaUrl] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (aiTestResult) setTesting(false);
  }, [aiTestResult]);

  const buildConfig = (): AIConfig => ({
    provider,
    openai:
      provider === "openai"
        ? { baseUrl: baseUrl || undefined, model: model || undefined }
        : undefined,
    ollama:
      provider === "ollama"
        ? { baseUrl: ollamaUrl || undefined, model: model || undefined }
        : undefined,
  });

  const testConnection = () => {
    setTesting(true);
    postMessage({
      type: "action:testAI",
      ai: buildConfig(),
      apiKey: provider === "openai" && apiKey ? apiKey : undefined,
    });
  };

  const canContinue = () => {
    if (provider === "cursor") return true;
    if (provider === "openai") return !!apiKey;
    if (provider === "ollama") return true;
    return false;
  };

  const handleContinue = () => {
    postMessage({
      type: "onboarding:setAI",
      ai: buildConfig(),
      apiKey: provider === "openai" && apiKey ? apiKey : undefined,
    });
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <Sparkles size={16} className="text-yellow-400" />
          <h2 className="text-sm font-semibold">AI Synthesis</h2>
        </div>
        <p className="text-xs text-vscode-descFg">
          Choose how to power the AI that synthesizes your workday. This is what
          turns raw signals into a smart, prioritized plan.
        </p>
      </div>

      <div className="space-y-2">
        {AI_PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={`card w-full text-left transition-colors cursor-pointer bg-transparent border ${
              provider === p.id
                ? "border-vscode-link"
                : "border-vscode-border"
            }`}
            onClick={() => setProvider(p.id)}
          >
            <div className="flex items-center gap-3">
              <span
                className={
                  provider === p.id
                    ? "text-vscode-link"
                    : "text-vscode-descFg"
                }
              >
                {p.icon}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium">{p.name}</div>
                <div className="text-[10px] text-vscode-descFg">
                  {p.description}
                </div>
              </div>
              {provider === p.id && (
                <CheckCircle2 size={16} className="text-vscode-link shrink-0" />
              )}
            </div>
          </button>
        ))}
      </div>

      {provider === "openai" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1">API Key</label>
            <input
              type="password"
              className="input"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-..."
            />
            <p className="text-[10px] text-vscode-descFg mt-0.5">
              Stored securely in your system keychain
            </p>
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">
              Base URL <span className="text-vscode-descFg">(optional)</span>
            </label>
            <input
              type="text"
              className="input"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com"
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">
              Model <span className="text-vscode-descFg">(optional)</span>
            </label>
            <input
              type="text"
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
            />
          </div>
        </div>
      )}

      {provider === "ollama" && (
        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium block mb-1">
              Ollama URL <span className="text-vscode-descFg">(optional)</span>
            </label>
            <input
              type="text"
              className="input"
              value={ollamaUrl}
              onChange={(e) => setOllamaUrl(e.target.value)}
              placeholder="http://localhost:11434"
            />
          </div>
          <div>
            <label className="text-xs font-medium block mb-1">
              Model <span className="text-vscode-descFg">(optional)</span>
            </label>
            <input
              type="text"
              className="input"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="llama3.2"
            />
          </div>
        </div>
      )}

      {provider !== "cursor" && (
        <>
          <button
            className="btn-secondary w-full flex items-center justify-center gap-1"
            onClick={testConnection}
            disabled={testing || (provider === "openai" && !apiKey)}
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

      <button
        className="btn-primary w-full"
        onClick={handleContinue}
        disabled={!canContinue()}
      >
        Continue
      </button>
    </div>
  );
}

function ConfigureStep() {
  const [workdayHours, setWorkdayHours] = useState(8);
  const [startTime, setStartTime] = useState("09:00");
  const [autoSync, setAutoSync] = useState(true);

  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">Configure</h2>
        <p className="text-xs text-vscode-descFg">
          Set your workday preferences.
        </p>
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

      <button
        className="btn-primary w-full"
        onClick={() =>
          postMessage({
            type: "onboarding:configure",
            config: {
              workdayMinutes: workdayHours * 60,
              startTime,
              autoSync,
            },
          })
        }
      >
        Continue
      </button>
    </div>
  );
}

function ValidateStep() {
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="text-sm font-semibold mb-1">Ready to Go</h2>
        <p className="text-xs text-vscode-descFg">
          Your setup looks good. Let's synthesize your first workday.
        </p>
      </div>

      <div className="card flex items-center gap-2 py-4 justify-center">
        <CheckCircle2 size={20} className="text-vscode-success" />
        <span className="text-xs font-medium">All connectors validated</span>
      </div>

      <button
        className="btn-primary w-full"
        onClick={() => postMessage({ type: "onboarding:complete" })}
      >
        Synthesize My Day
      </button>
    </div>
  );
}

import React, { useState } from "react";
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
} from "lucide-react";
import type { ConnectorInfo } from "../../../../src/types";

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

import React, { useState, useEffect } from "react";
import { usePlanStore } from "../../stores/planStore";
import { postMessage } from "../../hooks/useVSCode";
import {
  ArrowLeft,
  ToggleLeft,
  ToggleRight,
  RotateCcw,
} from "lucide-react";

export function SettingsView() {
  const { config, setView } = usePlanStore();

  const [workdayHours, setWorkdayHours] = useState(
    config ? config.workdayMinutes / 60 : 8
  );
  const [startTime, setStartTime] = useState(config?.startTime ?? "09:00");
  const [autoSync, setAutoSync] = useState(config?.autoSync ?? true);

  useEffect(() => {
    if (config) {
      setWorkdayHours(config.workdayMinutes / 60);
      setStartTime(config.startTime);
      setAutoSync(config.autoSync);
    }
  }, [config]);

  const save = () => {
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
          <div>Onboarding: {config.onboardingState}</div>
        </div>
      )}
    </div>
  );
}

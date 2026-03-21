import React, { useCallback } from "react";
import { usePlanStore } from "./stores/planStore";
import { useExtensionMessages, useVSCodeReady } from "./hooks/useVSCode";
import { PlanView } from "./components/Plan/PlanView";
import { OnboardingWizard } from "./components/Onboarding/OnboardingWizard";
import { SettingsView } from "./components/Settings/SettingsView";
import type { ExtensionMessage } from "../../src/types";
import { Loader2 } from "lucide-react";

export function App() {
  const { view, initialized, handleMessage } = usePlanStore();

  const onMessage = useCallback(
    (msg: ExtensionMessage) => handleMessage(msg),
    [handleMessage]
  );

  useExtensionMessages(onMessage);
  useVSCodeReady();

  if (!initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-2">
        <Loader2 size={20} className="animate-spin text-vscode-descFg" />
        <span className="text-xs text-vscode-descFg">Loading...</span>
      </div>
    );
  }

  switch (view) {
    case "onboarding":
      return <OnboardingWizard />;
    case "settings":
      return <SettingsView />;
    case "plan":
    default:
      return <PlanView />;
  }
}

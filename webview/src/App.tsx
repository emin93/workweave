import React, { useCallback } from "react";
import { usePlanStore } from "./stores/planStore";
import { useExtensionMessages, useVSCodeReady } from "./hooks/useVSCode";
import { PlanView } from "./components/Plan/PlanView";
import { OnboardingWizard } from "./components/Onboarding/OnboardingWizard";
import { SettingsView } from "./components/Settings/SettingsView";
import type { ExtensionMessage } from "../../src/types";

export function App() {
  const { view, handleMessage } = usePlanStore();

  const onMessage = useCallback(
    (msg: ExtensionMessage) => handleMessage(msg),
    [handleMessage]
  );

  useExtensionMessages(onMessage);
  useVSCodeReady();

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

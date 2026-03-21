import { create } from "zustand";
import type {
  WorkdayPlan,
  UserConfig,
  ConnectorInfo,
  OnboardingState,
  ExtensionMessage,
} from "../../../src/types";

interface PlanState {
  plan: WorkdayPlan | null;
  config: UserConfig | null;
  connectors: ConnectorInfo[];
  syncing: boolean;
  error: string | null;
  onboardingStep: OnboardingState;
  detectedConnectors: ConnectorInfo[];
  view: "plan" | "onboarding" | "settings";
  initialized: boolean;

  handleMessage: (message: ExtensionMessage) => void;
  setView: (view: "plan" | "onboarding" | "settings") => void;
}

export const usePlanStore = create<PlanState>((set, get) => ({
  plan: null,
  config: null,
  connectors: [],
  syncing: false,
  error: null,
  onboardingStep: "not_started",
  detectedConnectors: [],
  view: "onboarding",
  initialized: false,

  handleMessage: (message: ExtensionMessage) => {
    switch (message.type) {
      case "state:plan":
        set({
          plan: message.plan,
          view: "plan",
          error: null,
          initialized: true,
        });
        break;
      case "state:config": {
        const isSettingsOpen = get().view === "settings";
        set({ config: message.config });
        // If settings view is open, keep it open (config was requested by settings)
        if (isSettingsOpen) break;
        // If onboarding is complete but we haven't initialized yet, go to plan view
        if (message.config.onboardingState === "complete") {
          set({ view: "plan", initialized: true });
        }
        break;
      }
      case "state:connectors":
        set({ connectors: message.connectors });
        break;
      case "state:syncing":
        set({ syncing: message.syncing });
        break;
      case "state:error":
        set({ error: message.error, syncing: false, view: "plan", initialized: true });
        break;
      case "state:onboarding":
        set({
          onboardingStep: message.step,
          view: message.step === "complete" ? "plan" : "onboarding",
          initialized: true,
        });
        if (message.detectedConnectors) {
          set({ detectedConnectors: message.detectedConnectors });
        }
        break;
    }
  },

  setView: (view) => set({ view }),
}));

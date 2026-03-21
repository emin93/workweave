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

  handleMessage: (message: ExtensionMessage) => {
    switch (message.type) {
      case "state:plan":
        set({
          plan: message.plan,
          view: "plan",
          error: null,
        });
        break;
      case "state:config":
        set({ config: message.config });
        if (message.config.onboardingState === "complete") {
          set({ view: get().plan ? "plan" : "plan" });
        }
        break;
      case "state:connectors":
        set({ connectors: message.connectors });
        break;
      case "state:syncing":
        set({ syncing: message.syncing });
        break;
      case "state:error":
        set({ error: message.error, syncing: false });
        break;
      case "state:onboarding":
        set({
          onboardingStep: message.step,
          view: message.step === "complete" ? "plan" : "onboarding",
        });
        if (message.detectedConnectors) {
          set({ detectedConnectors: message.detectedConnectors });
        }
        break;
    }
  },

  setView: (view) => set({ view }),
}));

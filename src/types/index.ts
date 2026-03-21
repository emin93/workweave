// ── Artifact Types ──

export type ArtifactType =
  | "pr"
  | "issue"
  | "slack_message"
  | "slack_thread"
  | "meeting"
  | "notion_page"
  | "commit";

export type TaskStatus = "todo" | "in_progress" | "done" | "snoozed";

export type ActionType =
  | "plan"
  | "review"
  | "investigate"
  | "open_url"
  | "mark_done"
  | "snooze"
  | "start_work";

// ── Raw Events ──

export interface RawEvent {
  id: string;
  connectorId: string;
  sourceType: string;
  rawPayload: unknown;
  fetchedAt: string;
}

// ── Artifacts ──

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  description?: string;
  sourceUrl: string;
  connectorId: string;
  externalId: string;
  priority?: number; // normalized 0-1
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  relatedArtifactIds: string[];
}

// ── Execution Actions ──

export interface ExecutionAction {
  id: string;
  type: ActionType;
  label: string;
  icon?: string;
  params: Record<string, unknown>;
}

// ── Task Clusters ──

export interface TaskCluster {
  id: string;
  title: string;
  summary: string;
  category: TaskCategory;
  artifacts: Artifact[];
  priorityScore: number; // 0-100
  priorityReasons: string[];
  estimatedMinutes: number;
  status: TaskStatus;
  actions: ExecutionAction[];
  snoozedUntil?: string;
  scheduledSlot?: { start: number; end: number };
}

export type TaskCategory =
  | "review"
  | "implementation"
  | "respond"
  | "investigate"
  | "meeting_prep"
  | "follow_up"
  | "other";

// ── Workday Plan ──

export interface WorkdayPlan {
  id: string;
  date: string;
  clusters: TaskCluster[];
  totalMinutes: number;
  usedMinutes: number;
  generatedAt: string;
}

// ── Connector Types ──

export type ConnectorAuthMethod = "cli" | "extension" | "token";

export type ConnectorStatus =
  | { available: true; authMethod: ConnectorAuthMethod }
  | { available: false; reason: string; setupInstructions: string };

export interface ConnectorCapability {
  type: ArtifactType;
  description: string;
}

export interface Connector {
  id: string;
  name: string;
  icon: string;
  detect(): Promise<ConnectorStatus>;
  authenticate(): Promise<boolean>;
  fetch(): Promise<RawEvent[]>;
  getCapabilities(): ConnectorCapability[];
}

// ── User Configuration ──

export type OnboardingState =
  | "not_started"
  | "detecting"
  | "selecting"
  | "configuring"
  | "validating"
  | "complete";

export interface ConnectorConfig {
  id: string;
  enabled: boolean;
  authMethod: ConnectorAuthMethod;
  settings: Record<string, unknown>;
}

export interface UserConfig {
  workdayMinutes: number;
  startTime: string;
  autoSync: boolean;
  enabledConnectors: ConnectorConfig[];
  onboardingState: OnboardingState;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  workdayMinutes: 480,
  startTime: "09:00",
  autoSync: true,
  enabledConnectors: [],
  onboardingState: "not_started",
};

// ── Webview Messages ──

export type ExtensionMessage =
  | { type: "state:plan"; plan: WorkdayPlan | null }
  | { type: "state:config"; config: UserConfig }
  | { type: "state:connectors"; connectors: ConnectorInfo[] }
  | { type: "state:syncing"; syncing: boolean }
  | { type: "state:error"; error: string }
  | { type: "state:onboarding"; step: OnboardingState; detectedConnectors?: ConnectorInfo[] };

export type WebviewMessage =
  | { type: "action:synthesize" }
  | { type: "action:execute"; clusterId: string; actionId: string }
  | { type: "action:snooze"; clusterId: string; hours: number }
  | { type: "action:markDone"; clusterId: string }
  | { type: "action:openSettings" }
  | { type: "action:resetOnboarding" }
  | { type: "onboarding:selectConnectors"; connectorIds: string[] }
  | { type: "onboarding:configure"; config: Partial<UserConfig> }
  | { type: "onboarding:complete" }
  | { type: "ready" };

export interface ConnectorInfo {
  id: string;
  name: string;
  icon: string;
  status: ConnectorStatus;
  capabilities: ConnectorCapability[];
}

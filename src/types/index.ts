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
  | "context_link"
  | "mark_done"
  | "snooze"
  | "start_work";

export interface RawEvent {
  id: string;
  connectorId: string;
  sourceType: string;
  rawPayload: unknown;
  fetchedAt: string;
}

export interface Artifact {
  id: string;
  type: ArtifactType;
  title: string;
  description?: string;
  sourceUrl: string;
  connectorId: string;
  externalId: string;
  priority?: number;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
  relatedArtifactIds: string[];
}

export interface ExecutionAction {
  id: string;
  type: ActionType;
  label: string;
  icon?: string;
  params: Record<string, unknown>;
}

export interface TaskCluster {
  id: string;
  title: string;
  summary: string;
  category: TaskCategory;
  artifacts: Artifact[];
  priorityScore: number;
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

export type AIProviderType = "openai" | "anthropic" | "ollama";

export interface WorkdayPlan {
  id: string;
  date: string;
  clusters: TaskCluster[];
  totalMinutes: number;
  usedMinutes: number;
  generatedAt: string;
  synthesisMode?: "ai" | "rules";
  synthesisProvider?: AIProviderType;
}

export type ConnectorAuthMethod = "cli" | "token";

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

export interface ConnectorInfo {
  id: string;
  name: string;
  icon: string;
  status: ConnectorStatus;
  capabilities: ConnectorCapability[];
}

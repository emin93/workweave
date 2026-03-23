import * as vscode from "vscode";
import type { UserConfig, WorkdayPlan, RawEvent, AIConfig } from "../types";
import { DEFAULT_USER_CONFIG as defaults, DEFAULT_AI_CONFIG } from "../types";

const KEYS = {
  config: "workday.config",
  plan: "workday.plan",
  rawEvents: "workday.rawEvents",
  lastFullSynthesisDate: "workday.lastFullSynthesisDate",
  lastSyncedArtifactIds: "workday.lastSyncedArtifactIds",
} as const;

const AI_KEY_SECRET = "workday.ai.apiKey";

export class StorageLayer {
  private _globalState: vscode.Memento;
  private _secrets: vscode.SecretStorage;
  private _storageUri: vscode.Uri;

  constructor(private readonly context: vscode.ExtensionContext) {
    this._globalState = context.globalState;
    this._secrets = context.secrets;
    this._storageUri =
      context.globalStorageUri ?? context.extensionUri;
  }

  // ── Config ──

  getConfig(): UserConfig {
    const stored = this._globalState.get<UserConfig>(KEYS.config);
    if (!stored) return { ...defaults };
    const rawAi: Record<string, unknown> = { ...DEFAULT_AI_CONFIG, ...(stored.ai ?? {}) };
    if ("enabled" in rawAi) {
      delete rawAi.enabled;
    }
    if (rawAi.provider === "none") {
      rawAi.provider = "cursor";
    }
    const ai = rawAi as unknown as AIConfig;
    return { ...defaults, ...stored, ai };
  }

  async saveConfig(config: UserConfig): Promise<void> {
    await this._globalState.update(KEYS.config, config);
  }

  async updateConfig(partial: Partial<UserConfig>): Promise<UserConfig> {
    const current = this.getConfig();
    const updated = { ...current, ...partial };
    await this.saveConfig(updated);
    return updated;
  }

  // ── Plan Cache ──

  getCachedPlan(): WorkdayPlan | null {
    const plan = this._globalState.get<WorkdayPlan>(KEYS.plan);
    if (!plan) return null;
    const today = new Date().toISOString().split("T")[0];
    if (plan.date !== today) return null;
    return plan;
  }

  async cachePlan(plan: WorkdayPlan): Promise<void> {
    await this._globalState.update(KEYS.plan, plan);
  }

  async clearCachedPlan(): Promise<void> {
    await this._globalState.update(KEYS.plan, undefined);
  }

  async updatePlan(
    updater: (plan: WorkdayPlan) => WorkdayPlan
  ): Promise<WorkdayPlan | null> {
    const plan = this.getCachedPlan();
    if (!plan) return null;
    const updated = updater(plan);
    await this.cachePlan(updated);
    return updated;
  }

  // ── Raw Events Cache ──

  cacheRawEvents(events: RawEvent[]): void {
    this._globalState.update(KEYS.rawEvents, events);
  }

  getCachedRawEvents(): RawEvent[] {
    return this._globalState.get<RawEvent[]>(KEYS.rawEvents) ?? [];
  }

  // ── Secrets ──

  async getSecret(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  async setSecret(key: string, value: string): Promise<void> {
    await this._secrets.store(key, value);
  }

  async deleteSecret(key: string): Promise<void> {
    await this._secrets.delete(key);
  }

  // ── AI Config ──

  getAIConfig(): AIConfig {
    const config = this.getConfig();
    return config.ai ?? { ...DEFAULT_AI_CONFIG };
  }

  async saveAIConfig(ai: AIConfig): Promise<void> {
    await this.updateConfig({ ai });
  }

  async getAIApiKey(): Promise<string | undefined> {
    return this._secrets.get(AI_KEY_SECRET);
  }

  async setAIApiKey(key: string): Promise<void> {
    await this._secrets.store(AI_KEY_SECRET, key);
  }

  async deleteAIApiKey(): Promise<void> {
    await this._secrets.delete(AI_KEY_SECRET);
  }

  // ── Sync metadata (stable daily AI + incremental) ──

  getLastFullSynthesisDate(): string | undefined {
    return this._globalState.get<string>(KEYS.lastFullSynthesisDate);
  }

  async setLastFullSynthesisDate(date: string): Promise<void> {
    await this._globalState.update(KEYS.lastFullSynthesisDate, date);
  }

  getLastSyncedArtifactIds(): string[] {
    return this._globalState.get<string[]>(KEYS.lastSyncedArtifactIds) ?? [];
  }

  async setLastSyncedArtifactIds(ids: string[]): Promise<void> {
    const unique = [...new Set(ids)].sort();
    await this._globalState.update(KEYS.lastSyncedArtifactIds, unique);
  }

  async clearSyncMetadata(): Promise<void> {
    await this._globalState.update(KEYS.lastFullSynthesisDate, undefined);
    await this._globalState.update(KEYS.lastSyncedArtifactIds, undefined);
  }

  // ── Reset ──

  async reset(): Promise<void> {
    await this._globalState.update(KEYS.config, undefined);
    await this._globalState.update(KEYS.plan, undefined);
    await this._globalState.update(KEYS.rawEvents, undefined);
    await this.clearSyncMetadata();
  }
}

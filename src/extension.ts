import * as vscode from "vscode";
import { SidebarProvider } from "./webview/SidebarProvider";
import { ConnectorRegistry } from "./connectors/registry";
import { GitHubConnector } from "./connectors/github";
import { LinearConnector } from "./connectors/linear";
import { SlackConnector } from "./connectors/slack";
import { StorageLayer } from "./storage/store";
import { IngestionOrchestrator, log } from "./pipeline/ingest";
import { normalize } from "./pipeline/normalize";
import { schedule } from "./pipeline/schedule";
import { correlate } from "./pipeline/correlate";
import { prioritize } from "./pipeline/prioritize";
import {
  applyClusterStatuses,
  calendarTodayString,
  mergeByPriorityInsertion,
  pruneAndRefreshClusters,
} from "./pipeline/merge-plan";
import { aiSynthesize } from "./pipeline/ai-synthesize";
import {
  OpenAIProvider,
  OllamaProvider,
  CursorChatProvider,
  type LLMProvider,
} from "./ai/provider";
import { ExecutionEngine } from "./execution/actions";
import { OnboardingManager } from "./onboarding/wizard";
import type { UserConfig, WorkdayPlan, WebviewMessage } from "./types";

let statusBarItem: vscode.StatusBarItem;

export function activate(context: vscode.ExtensionContext) {
  const storage = new StorageLayer(context);
  const registry = new ConnectorRegistry();
  registry.register(new GitHubConnector());
  registry.register(new LinearConnector());

  const slackConnector = new SlackConnector();
  slackConnector.setContext(context);
  registry.register(slackConnector);

  const ingestion = new IngestionOrchestrator(registry);
  const execution = new ExecutionEngine(storage);
  const onboarding = new OnboardingManager(storage, registry);

  const sidebarProvider = new SidebarProvider(
    context.extensionUri,
    context,
    handleWebviewMessage
  );

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "workday.sidebarView",
      sidebarProvider
    )
  );

  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    50
  );
  statusBarItem.command = "workday.synthesize";
  statusBarItem.text = "$(calendar) Workday";
  statusBarItem.tooltip = "Synthesize your workday";
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.synthesize", () =>
      synthesize(sidebarProvider, storage, ingestion, onboarding)
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.openSettings", () => {
      sidebarProvider.postMessage({
        type: "state:config",
        config: storage.getConfig(),
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.resetOnboarding", async () => {
      await onboarding.reset();
      const detected = await onboarding.detectEnvironment();
      sidebarProvider.postMessage({
        type: "state:onboarding",
        step: "detecting",
        detectedConnectors: detected,
      });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.setSlackToken", async () => {
      const saved = await SlackConnector.promptForToken(context);
      if (saved) {
        const detected = await registry.detectAll();
        sidebarProvider.postMessage({
          type: "state:connectors",
          connectors: detected,
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("workday.setAIKey", async () => {
      const key = await vscode.window.showInputBox({
        title: "AI API Key",
        prompt: "Enter your OpenAI API key (or compatible provider key)",
        placeHolder: "sk-...",
        password: true,
        validateInput: (value) => {
          if (!value) return "API key is required";
          return null;
        },
      });
      if (!key) return;
      await storage.setAIApiKey(key);
      vscode.window.showInformationMessage("AI API key saved.");
    })
  );

  async function handleWebviewMessage(message: WebviewMessage) {
    switch (message.type) {
      case "ready": {
        const config = storage.getConfig();
        log.info(`Webview ready. Onboarding state: ${config.onboardingState}`);
        log.info(`Enabled connectors: ${JSON.stringify(config.enabledConnectors.map(c => ({ id: c.id, enabled: c.enabled })))}`);

        if (config.onboardingState !== "complete") {
          const detected = await onboarding.detectEnvironment();
          log.info(`Detected connectors: ${JSON.stringify(detected.map(c => ({ id: c.id, available: c.status.available })))}`);
          sidebarProvider.postMessage({
            type: "state:onboarding",
            step: config.onboardingState === "not_started" ? "detecting" : config.onboardingState,
            detectedConnectors: detected,
          });
        } else {
          // Send config first so webview knows onboarding is complete
          sidebarProvider.postMessage({ type: "state:config", config });
          // Then send cached plan (may be null for a new day)
          const cachedPlan = storage.getCachedPlan();
          log.info(`Cached plan: ${cachedPlan ? `${cachedPlan.clusters.length} clusters` : "none"}`);
          sidebarProvider.postMessage({
            type: "state:plan",
            plan: cachedPlan,
          });
          // Auto-sync if no cached plan
          if (!cachedPlan && config.autoSync) {
            log.info("No cached plan for today, auto-syncing...");
            await synthesize(sidebarProvider, storage, ingestion, onboarding);
          }
        }
        break;
      }
      case "action:synthesize":
        await synthesize(sidebarProvider, storage, ingestion, onboarding);
        break;
      case "action:execute":
        await execution.execute(
          message.clusterId,
          message.actionId,
          storage.getCachedPlan()
        );
        break;
      case "action:snooze":
        await execution.snooze(
          message.clusterId,
          message.hours,
          storage
        );
        sidebarProvider.postMessage({
          type: "state:plan",
          plan: storage.getCachedPlan(),
        });
        break;
      case "action:markDone":
        await execution.markDone(message.clusterId, storage);
        sidebarProvider.postMessage({
          type: "state:plan",
          plan: storage.getCachedPlan(),
        });
        updateStatusBar(storage.getCachedPlan());
        break;
      case "onboarding:selectConnectors":
        log.info(`Selecting connectors: ${JSON.stringify(message.connectorIds)}`);
        await onboarding.selectConnectors(message.connectorIds);
        log.info(`Config after select: ${JSON.stringify(storage.getConfig().enabledConnectors)}`);
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "ai_setup",
        });
        break;
      case "onboarding:setAI": {
        log.info(`Setting AI provider: ${message.ai.provider}`);
        await onboarding.saveAIConfig(message.ai, message.apiKey);
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "configuring",
        });
        break;
      }
      case "onboarding:configure":
        await onboarding.configure(message.config);
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "validating",
        });
        break;
      case "onboarding:complete":
        await onboarding.complete();
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "complete",
        });
        await synthesize(sidebarProvider, storage, ingestion, onboarding);
        break;
      case "action:openSettings":
        sidebarProvider.postMessage({
          type: "state:config",
          config: storage.getConfig(),
        });
        break;
      case "action:resetOnboarding": {
        await onboarding.reset();
        const detected = await onboarding.detectEnvironment();
        sidebarProvider.postMessage({
          type: "state:onboarding",
          step: "detecting",
          detectedConnectors: detected,
        });
        break;
      }
      case "action:setAIConfig": {
        await storage.saveAIConfig(message.ai);
        sidebarProvider.postMessage({
          type: "state:config",
          config: storage.getConfig(),
        });
        break;
      }
      case "action:setAIKey": {
        if (message.apiKey) {
          await storage.setAIApiKey(message.apiKey);
        } else {
          await storage.deleteAIApiKey();
        }
        break;
      }
      case "action:testAI": {
        try {
          await storage.saveAIConfig(message.ai);
          if (message.apiKey) {
            await storage.setAIApiKey(message.apiKey);
          }

          if (message.ai.provider === "cursor") {
            sidebarProvider.postMessage({
              type: "state:aiTestResult",
              success: true,
              message: "Cursor Chat is always available",
            });
            break;
          }

          const provider = await resolveAIProvider(storage);
          log.info(`Testing AI provider: ${provider.name} (${provider.id})`);

          const available = await provider.isAvailable();
          if (!available) {
            const aiKey = await storage.getAIApiKey();
            log.info(`AI test: provider=${message.ai.provider}, hasKey=${!!aiKey}`);
            sidebarProvider.postMessage({
              type: "state:aiTestResult",
              success: false,
              message: "Provider not available. Check your API key and settings.",
            });
            break;
          }

          log.info("AI test: provider available, sending test prompt...");
          const result = await provider.complete(
            'Respond with exactly this JSON: {"status":"ok"}'
          );
          log.info(`AI test response: ${result.slice(0, 200)}`);

          const parsed = JSON.parse(result);
          sidebarProvider.postMessage({
            type: "state:aiTestResult",
            success: parsed.status === "ok",
            message: parsed.status === "ok"
              ? `Connected to ${provider.name} successfully`
              : "Unexpected response from provider",
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          log.error(`AI test failed: ${msg}`);
          sidebarProvider.postMessage({
            type: "state:aiTestResult",
            success: false,
            message: msg,
          });
        }
        break;
      }
    }
  }

  const config = storage.getConfig();
  if (config.onboardingState === "complete" && config.autoSync) {
    setTimeout(() => {
      synthesize(sidebarProvider, storage, ingestion, onboarding);
    }, 3000);
  }
}

async function resolveAIProvider(
  storage: StorageLayer
): Promise<LLMProvider> {
  const aiConfig = storage.getAIConfig();

  if (aiConfig.provider === "openai") {
    const apiKey = await storage.getAIApiKey();
    if (!apiKey) {
      return new CursorChatProvider(getWorkspacePath());
    }
    return new OpenAIProvider({
      apiKey,
      baseUrl: aiConfig.openai?.baseUrl,
      model: aiConfig.openai?.model,
    });
  }

  if (aiConfig.provider === "ollama") {
    return new OllamaProvider({
      baseUrl: aiConfig.ollama?.baseUrl,
      model: aiConfig.ollama?.model,
    });
  }

  return new CursorChatProvider(getWorkspacePath());
}

function getWorkspacePath(): string {
  const folders = vscode.workspace.workspaceFolders;
  if (folders && folders.length > 0) {
    return folders[0].uri.fsPath;
  }
  return process.env.HOME || process.env.USERPROFILE || ".";
}

async function synthesize(
  sidebar: SidebarProvider,
  storage: StorageLayer,
  ingestion: IngestionOrchestrator,
  onboarding: OnboardingManager
) {
  const config = storage.getConfig();
  if (config.onboardingState !== "complete") {
    return;
  }

  sidebar.postMessage({ type: "state:syncing", syncing: true });
  statusBarItem.text = "$(sync~spin) Syncing...";

  try {
    const enabledIds = config.enabledConnectors
      .filter((c) => c.enabled)
      .map((c) => c.id);

    log.info(`Synthesizing with connectors: ${enabledIds.join(", ") || "(none)"}`);
    log.info(`All connector configs: ${JSON.stringify(config.enabledConnectors)}`);

    if (enabledIds.length === 0) {
      log.warn("No connectors enabled. Resetting onboarding.");
      sidebar.postMessage({
        type: "state:error",
        error: "No connectors enabled. Please set up your connectors.",
      });
      await onboarding.reset();
      const detected = await onboarding.detectEnvironment();
      sidebar.postMessage({
        type: "state:onboarding",
        step: "detecting",
        detectedConnectors: detected,
      });
      sidebar.postMessage({ type: "state:syncing", syncing: false });
      return;
    }

    const { events: rawEvents, errors: connectorErrors } =
      await ingestion.fetchAll(enabledIds);
    storage.cacheRawEvents(rawEvents);

    log.info(`Raw events: ${rawEvents.length}`);

    if (connectorErrors.length > 0) {
      const warning = connectorErrors.join("\n");
      log.warn(`Partial connector failures:\n${warning}`);
      sidebar.postMessage({
        type: "state:error",
        error: `Some connectors had issues:\n${warning}`,
      });
    }

    const artifacts = normalize(rawEvents);
    log.info(`Artifacts: ${artifacts.length}`);

    const today = calendarTodayString();
    const artifactById = new Map(artifacts.map((a) => [a.id, a]));
    const currentIdList = artifacts.map((a) => a.id);

    const cached = storage.getCachedPlan();
    let lastFull = storage.getLastFullSynthesisDate();
    let lastSyncedIds = storage.getLastSyncedArtifactIds();

    // Migrate older installs: plan exists but sync metadata was never written.
    // Without this, lastSynced stayed empty → full AI every sync → repeated "rules" fallback.
    if (cached) {
      if (lastFull === undefined) {
        await storage.setLastFullSynthesisDate(cached.date);
        lastFull = cached.date;
        log.info("Migrated lastFullSynthesisDate from cached plan");
      }
      if (lastSyncedIds.length === 0 && currentIdList.length > 0) {
        await storage.setLastSyncedArtifactIds(currentIdList);
        lastSyncedIds = currentIdList;
        log.info("Migrated lastSyncedArtifactIds from current artifacts");
      }
    }

    const lastSyncedSet = new Set(lastSyncedIds);

    // Full AI at most once per calendar day — do NOT force it when lastSynced was merely empty.
    const needsFullAI = !cached || lastFull !== today;

    const aiProvider = await resolveAIProvider(storage);

    if (needsFullAI) {
      const { clusters, mode } = await aiSynthesize(artifacts, aiProvider, log);
      log.info(`Synthesis mode: ${mode}, clusters: ${clusters.length}`);

      const plan = schedule(clusters, config.workdayMinutes);
      plan.synthesisMode = mode;
      plan.synthesisProvider = config.ai.provider;
      log.info(
        `Plan: ${plan.clusters.length} clusters, ${plan.usedMinutes}m used (${mode}, ${aiProvider.name})`
      );

      await storage.cachePlan(plan);
      await storage.setLastFullSynthesisDate(today);
      await storage.setLastSyncedArtifactIds(currentIdList);
      sidebar.postMessage({ type: "state:plan", plan });
      updateStatusBar(plan);
    } else {
      const newIds = currentIdList.filter((id) => !lastSyncedSet.has(id));
      if (newIds.length === 0) {
        log.info("Incremental sync: no new artifacts, keeping cached plan");
        sidebar.postMessage({ type: "state:plan", plan: cached });
        updateStatusBar(cached);
      } else {
        log.info(
          `Incremental sync: ${newIds.length} new artifact(s), merging into cached plan`
        );
        const previous = pruneAndRefreshClusters(cached.clusters, artifactById);
        const newArtifacts = artifacts.filter((a) => newIds.includes(a.id));
        const correlated = correlate(newArtifacts);
        const newClusters = prioritize(correlated);
        const merged = mergeByPriorityInsertion(previous, newClusters);
        const withStatus = applyClusterStatuses(merged, cached.clusters);

        const plan = schedule(withStatus, config.workdayMinutes);
        // Incremental merge uses rules only for *new* items; keep AI badge unless the cached day was already rules-fallback.
        plan.synthesisMode =
          cached.synthesisMode === "rules" ? "rules" : "ai";
        plan.synthesisProvider =
          cached.synthesisProvider ?? config.ai.provider;

        await storage.cachePlan(plan);
        await storage.setLastSyncedArtifactIds(currentIdList);
        log.info(
          `Plan (incremental): ${plan.clusters.length} clusters, ${plan.usedMinutes}m used`
        );
        sidebar.postMessage({ type: "state:plan", plan });
        updateStatusBar(plan);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error(`Synthesis failed: ${msg}`);
    sidebar.postMessage({ type: "state:error", error: msg });
    vscode.window.showErrorMessage(`Workday Synthesizer: ${msg}`);
  } finally {
    sidebar.postMessage({ type: "state:syncing", syncing: false });
  }
}

function updateStatusBar(plan: WorkdayPlan | null) {
  if (!plan) {
    statusBarItem.text = "$(calendar) Workday";
    return;
  }
  const done = plan.clusters.filter((c) => c.status === "done").length;
  const total = plan.clusters.length;
  statusBarItem.text = `$(calendar) Workday: ${done}/${total} done`;
}

export function deactivate() {}

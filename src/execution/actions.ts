import * as vscode from "vscode";
import { exec } from "child_process";
import { promisify } from "util";
import type { WorkdayPlan, TaskCluster, ExecutionAction } from "../types";
import type { StorageLayer } from "../storage/store";
import {
  buildPlanPrompt,
  buildReviewPrompt,
  buildInvestigatePrompt,
} from "./prompts";

const execAsync = promisify(exec);

type CursorMode = "plan" | "agent" | "ask";

/**
 * Open Cursor chat with a prompt and auto-submit it.
 * Tries multiple approaches in order of reliability.
 */
async function sendToChat(prompt: string, mode?: CursorMode): Promise<void> {
  // Approach 1: Try Cursor's composerMode-aware command
  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", {
      query: prompt,
      isPartialQuery: false,
    });

    // Give the chat panel a moment to open and populate
    await sleep(300);

    // Try to submit by simulating Enter via the chat submit command
    try {
      await vscode.commands.executeCommand(
        "workbench.action.chat.submit"
      );
    } catch {
      // Command may not exist in Cursor — try alternative
      try {
        await vscode.commands.executeCommand(
          "workbench.action.chat.stopListeningAndSubmit"
        );
      } catch {
        // Neither command available — the prompt is at least populated
      }
    }

    return;
  } catch {
    // Fallback: open as markdown document
  }

  const doc = await vscode.workspace.openTextDocument({
    content: prompt,
    language: "markdown",
  });
  await vscode.window.showTextDocument(doc);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ExecutionEngine {
  constructor(private readonly storage: StorageLayer) {}

  async execute(
    clusterId: string,
    actionId: string,
    plan: WorkdayPlan | null
  ): Promise<void> {
    if (!plan) return;

    const cluster = plan.clusters.find((c) => c.id === clusterId);
    if (!cluster) return;

    const action = cluster.actions.find((a) => a.id === actionId);
    if (!action) return;

    switch (action.type) {
      case "plan":
        await this.executePlan(cluster);
        break;
      case "review":
        await this.executeReview(cluster, action);
        break;
      case "investigate":
        await this.executeInvestigate(cluster);
        break;
      case "open_url":
      case "context_link":
        await this.openUrl(action);
        break;
      case "mark_done":
        await this.markDone(clusterId, this.storage);
        break;
      case "snooze":
        await this.snooze(clusterId, 2, this.storage);
        break;
      case "start_work":
        await this.openUrl(action);
        break;
    }
  }

  private async executePlan(cluster: TaskCluster): Promise<void> {
    const prompt = buildPlanPrompt(cluster);
    await sendToChat(prompt, "plan");
    await this.updateClusterStatus(cluster.id, "in_progress");
  }

  private async executeReview(
    cluster: TaskCluster,
    action: ExecutionAction
  ): Promise<void> {
    const prNumber = action.params.prNumber as string;

    if (prNumber && vscode.workspace.workspaceFolders?.length) {
      try {
        await execAsync(`gh pr checkout ${prNumber}`, {
          cwd: vscode.workspace.workspaceFolders[0].uri.fsPath,
          timeout: 30_000,
        });
      } catch {
        // Checkout failed -- still open the review prompt
      }
    }

    const prompt = buildReviewPrompt(cluster);
    await sendToChat(prompt, "agent");
    await this.updateClusterStatus(cluster.id, "in_progress");
  }

  private async executeInvestigate(cluster: TaskCluster): Promise<void> {
    const prompt = buildInvestigatePrompt(cluster);
    await sendToChat(prompt, "ask");
    await this.updateClusterStatus(cluster.id, "in_progress");
  }

  private async openUrl(action: ExecutionAction): Promise<void> {
    const url = (action.params.url ?? action.params.prUrl) as string;
    if (url) {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    }
  }

  async markDone(clusterId: string, storage: StorageLayer): Promise<void> {
    await this.updateClusterStatus(clusterId, "done");
  }

  async snooze(
    clusterId: string,
    hours: number,
    storage: StorageLayer
  ): Promise<void> {
    const plan = storage.getCachedPlan();
    if (!plan) return;

    const updated = {
      ...plan,
      clusters: plan.clusters.map((c) =>
        c.id === clusterId
          ? {
              ...c,
              status: "snoozed" as const,
              snoozedUntil: new Date(
                Date.now() + hours * 60 * 60 * 1000
              ).toISOString(),
            }
          : c
      ),
    };

    await storage.cachePlan(updated);
  }

  private async updateClusterStatus(
    clusterId: string,
    status: "in_progress" | "done"
  ): Promise<void> {
    await this.storage.updatePlan((plan) => ({
      ...plan,
      clusters: plan.clusters.map((c) =>
        c.id === clusterId ? { ...c, status } : c
      ),
    }));
  }
}

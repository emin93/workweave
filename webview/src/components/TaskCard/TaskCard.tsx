import React, { useState } from "react";
import { postMessage } from "../../hooks/useVSCode";
import {
  GitPullRequest,
  Lightbulb,
  ExternalLink,
  Check,
  Clock,
  Reply,
  ChevronDown,
  ChevronRight,
  Info,
} from "lucide-react";
import type {
  TaskCluster,
  ExecutionAction,
  ActionType,
  TaskCategory,
} from "../../../../src/types";

const ACTION_ICONS: Record<ActionType, React.ReactNode> = {
  review: <GitPullRequest size={12} />,
  plan: <Lightbulb size={12} />,
  open_url: <ExternalLink size={12} />,
  mark_done: <Check size={12} />,
  snooze: <Clock size={12} />,
  start_work: <Reply size={12} />,
};

const CATEGORY_BADGE: Record<TaskCategory, { label: string; color: string }> = {
  review: { label: "Review", color: "text-purple-400" },
  implementation: { label: "Implement", color: "text-blue-400" },
  respond: { label: "Reply", color: "text-green-400" },
  investigate: { label: "Investigate", color: "text-yellow-400" },
  meeting_prep: { label: "Meeting", color: "text-orange-400" },
  follow_up: { label: "Follow up", color: "text-cyan-400" },
  other: { label: "Task", color: "text-vscode-descFg" },
};

interface TaskCardProps {
  cluster: TaskCluster;
  index?: number;
}

export function TaskCard({ cluster, index }: TaskCardProps) {
  const [expanded, setExpanded] = useState(false);
  const isDone = cluster.status === "done";
  const isSnoozed = cluster.status === "snoozed";
  const isInProgress = cluster.status === "in_progress";

  const badge = CATEGORY_BADGE[cluster.category] ?? CATEGORY_BADGE.other;

  const primaryActions = cluster.actions.filter(
    (a) =>
      a.type !== "mark_done" && a.type !== "snooze" && a.type !== "open_url"
  );
  const secondaryActions = cluster.actions.filter(
    (a) =>
      a.type === "open_url" || a.type === "mark_done" || a.type === "snooze"
  );

  return (
    <div
      className={`card transition-all ${
        isDone
          ? "opacity-50"
          : isSnoozed
            ? "opacity-40"
            : isInProgress
              ? "border-vscode-link"
              : ""
      }`}
    >
      <div className="flex items-start gap-2">
        {index !== undefined && (
          <span className="text-[10px] font-bold text-vscode-descFg mt-0.5 w-4 shrink-0 text-right">
            {index}
          </span>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            {isInProgress && (
              <span className="w-1.5 h-1.5 rounded-full bg-vscode-link shrink-0" />
            )}
            <h4
              className={`text-xs font-medium truncate ${isDone ? "line-through" : ""}`}
            >
              {cluster.title}
            </h4>
          </div>

          <div className="flex items-center gap-2 mt-0.5">
            <span
              className={`text-[9px] font-semibold uppercase tracking-wider ${badge.color}`}
            >
              {badge.label}
            </span>
            <span className="text-[10px] text-vscode-descFg">
              {cluster.summary}
            </span>
            {cluster.estimatedMinutes > 0 && (
              <span className="text-[10px] text-vscode-descFg">
                ~
                {cluster.estimatedMinutes >= 60
                  ? `${(cluster.estimatedMinutes / 60).toFixed(1)}h`
                  : `${cluster.estimatedMinutes}m`}
              </span>
            )}
          </div>

          {cluster.priorityReasons.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {cluster.priorityReasons.slice(0, 2).map((reason, i) => (
                <span
                  key={i}
                  className="text-[9px] px-1.5 py-0.5 rounded bg-vscode-badge/20 text-vscode-descFg"
                >
                  {reason}
                </span>
              ))}
            </div>
          )}
        </div>

        <button
          className="btn-ghost p-0.5 shrink-0"
          onClick={() => setExpanded(!expanded)}
          title="Details"
        >
          {expanded ? <ChevronDown size={12} /> : <Info size={12} />}
        </button>
      </div>

      {/* Action buttons */}
      {!isDone && !isSnoozed && (
        <div className="flex items-center gap-1 mt-2">
          {primaryActions.map((action) => (
            <button
              key={action.id}
              className="btn-primary flex items-center gap-1"
              onClick={() =>
                postMessage({
                  type: "action:execute",
                  clusterId: cluster.id,
                  actionId: action.id,
                })
              }
            >
              {ACTION_ICONS[action.type]}
              {action.label}
            </button>
          ))}
          <div className="flex-1" />
          {secondaryActions.map((action) => (
            <button
              key={action.id}
              className="btn-ghost flex items-center gap-1"
              onClick={() => {
                if (action.type === "mark_done") {
                  postMessage({
                    type: "action:markDone",
                    clusterId: cluster.id,
                  });
                } else if (action.type === "snooze") {
                  postMessage({
                    type: "action:snooze",
                    clusterId: cluster.id,
                    hours: 2,
                  });
                } else {
                  postMessage({
                    type: "action:execute",
                    clusterId: cluster.id,
                    actionId: action.id,
                  });
                }
              }}
              title={action.label}
            >
              {ACTION_ICONS[action.type]}
            </button>
          ))}
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div className="mt-2 pt-2 border-t border-vscode-border space-y-1.5">
          <div className="text-[10px] text-vscode-descFg">
            <span className="font-medium">Score:</span>{" "}
            {cluster.priorityScore.toFixed(1)}/100
          </div>
          {cluster.priorityReasons.map((reason, i) => (
            <div
              key={i}
              className="text-[10px] text-vscode-descFg flex items-center gap-1"
            >
              <span className="text-vscode-warning">&#x2022;</span> {reason}
            </div>
          ))}
          {cluster.artifacts.length > 1 && (
            <div className="text-[10px] text-vscode-descFg">
              <span className="font-medium">Related:</span>{" "}
              {cluster.artifacts.length} items
            </div>
          )}
          {cluster.artifacts.map((a) => (
            <div
              key={a.id}
              className="text-[10px] text-vscode-descFg flex items-center gap-1"
            >
              <span className="opacity-50">[{a.type}]</span>
              <a
                href={a.sourceUrl}
                className="text-vscode-link hover:underline truncate"
                title={a.sourceUrl}
              >
                {a.title}
              </a>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

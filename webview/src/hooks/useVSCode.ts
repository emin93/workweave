import { useEffect, useCallback } from "react";
import type { ExtensionMessage, WebviewMessage } from "../../../src/types";

interface VSCodeAPI {
  postMessage(message: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VSCodeAPI;

let vscodeApi: VSCodeAPI | null = null;

function getVSCodeApi(): VSCodeAPI {
  if (!vscodeApi) {
    vscodeApi = acquireVsCodeApi();
  }
  return vscodeApi;
}

export function postMessage(message: WebviewMessage): void {
  getVSCodeApi().postMessage(message);
}

export function useExtensionMessages(
  handler: (message: ExtensionMessage) => void
): void {
  useEffect(() => {
    const listener = (event: MessageEvent<ExtensionMessage>) => {
      handler(event.data);
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [handler]);
}

export function useVSCodeReady(): void {
  useEffect(() => {
    postMessage({ type: "ready" });
  }, []);
}

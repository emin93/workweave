import { createInterface } from "readline/promises";
import type { ConnectorRegistry } from "./connectors/registry";
import { envFilePath, upsertLocalEnv } from "./env";

export async function runSetup(registry: ConnectorRegistry): Promise<void> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("Workday Synthesizer setup");
    console.log("");
    console.log("This setup keeps the product simple:");
    console.log("- GitHub via `gh auth login`");
    console.log("- OpenAI via `OPENAI_API_KEY` in a local `.env` file");
    console.log("");

    const github = registry.get("github");
    if (github) {
      const status = await github.detect();
      if (status.available) {
        console.log("[ok] GitHub CLI is already authenticated.");
      } else {
        console.log("[action] GitHub is not ready yet.");
        console.log(status.reason);
        console.log("");
        console.log("Run this once in another terminal:");
        console.log("  gh auth login");
      }
      console.log("");
    }

    const existingKey = process.env.OPENAI_API_KEY;
    if (existingKey) {
      const replace = await yesNoPrompt(
        rl,
        "An OPENAI_API_KEY is already configured. Replace it?",
        false
      );
      if (!replace) {
        printNextSteps(false);
        return;
      }
    } else {
      const configure = await yesNoPrompt(
        rl,
        "Do you want to save an OPENAI_API_KEY to a local .env file now?",
        true
      );
      if (!configure) {
        printNextSteps(true);
        return;
      }
    }

    console.log("");
    console.log("Create a key at https://platform.openai.com/api-keys");
    const apiKey = (
      await rl.question("Paste OPENAI_API_KEY here (input is visible): ")
    ).trim();

    if (!apiKey) {
      console.log("No key entered. Leaving configuration unchanged.");
      printNextSteps(true);
      return;
    }

    const file = upsertLocalEnv("OPENAI_API_KEY", apiKey);
    console.log("");
    console.log(`Saved OPENAI_API_KEY to ${file}`);
    printNextSteps(false);
  } finally {
    rl.close();
  }
}

async function yesNoPrompt(
  rl: ReturnType<typeof createInterface>,
  question: string,
  defaultYes: boolean
): Promise<boolean> {
  const suffix = defaultYes ? " [Y/n] " : " [y/N] ";
  const answer = (await rl.question(`${question}${suffix}`)).trim().toLowerCase();

  if (!answer) return defaultYes;
  return answer === "y" || answer === "yes";
}

function printNextSteps(needsApiKey: boolean): void {
  console.log("");
  console.log("Next steps:");
  console.log("1. Run `npm run build`");
  console.log("2. Run `node dist/cli.js detect --connectors github`");
  if (needsApiKey) {
    console.log(
      "3. Add OPENAI_API_KEY, then run `node dist/cli.js synth --connectors github --ai`"
    );
  } else {
    console.log("3. Run `node dist/cli.js synth --connectors github --ai`");
  }
  console.log("");
  console.log(`Local config file: ${envFilePath()}`);
}

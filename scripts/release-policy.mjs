export const ACTION_PINS = {
  "actions/checkout": {
    sha: "34e114876b0b11c390a56381ad16ebd13914f8d5",
    version: "v4.3.1",
  },
  "actions/setup-node": {
    sha: "49933ea5288caeca8642d1e84afbd3f7d6820020",
    version: "v4.4.0",
  },
  "actions/upload-pages-artifact": {
    sha: "56afc609e74202658d3ffba0e8f6dda462b719fa",
    version: "v3.0.1",
  },
  "actions/configure-pages": {
    sha: "983d7736d9b0ae728b81ab479565c72886d7745b",
    version: "v5.0.0",
  },
  "actions/deploy-pages": {
    sha: "d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e",
    version: "v4.0.5",
  },
  "actions/download-artifact": {
    sha: "d3f86a106a0bac45b974a628896c90dbdf5c8093",
    version: "v4.3.0",
  },
};

function parseSteps(source) {
  const steps = [];
  for (const line of source.split("\n")) {
    const match = line.match(/^\s{6}-\s+(.+?)\s*$/);
    if (match) {
      const name = match[1].match(/^name:\s*(.+)$/)?.[1] ?? "(unnamed step)";
      steps.push({ name, lines: [line] });
    } else if (steps.length > 0) {
      steps.at(-1).lines.push(line);
    }
  }
  return steps;
}

function runCommands(step) {
  const commands = [];
  const lines = step.lines;
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(/^(\s*)(?:-\s+)?run:\s*(.*?)\s*$/);
    if (!match) {
      continue;
    }
    if (match[2] !== "|") {
      commands.push(match[2]);
      continue;
    }
    const runIndent = match[1].length;
    for (let commandIndex = index + 1; commandIndex < lines.length; commandIndex += 1) {
      const commandLine = lines[commandIndex];
      const trimmed = commandLine.trim();
      if (trimmed && commandLine.search(/\S/) <= runIndent) {
        break;
      }
      if (trimmed) {
        commands.push(trimmed);
      }
    }
  }
  return commands;
}

function actionUse(step) {
  for (const line of step.lines) {
    const match = line.match(
      /^\s*(?:-\s+)?uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S+))?\s*$/,
    );
    if (match) {
      return { action: match[1], reference: match[2], version: match[3] };
    }
  }
  return null;
}

function validateActionPins(source, requiredActions) {
  const problems = [];
  const usedActions = new Set();
  const actionLines = source.split("\n").filter((line) => /^\s*(?:-\s+)?uses:/.test(line));
  for (const line of actionLines) {
    const match = line.match(
      /^\s*(?:-\s+)?uses:\s*([^@\s]+)@([^\s#]+)(?:\s+#\s*(\S+))?\s*$/,
    );
    if (!match) {
      problems.push(`Third-party action line is not an auditable immutable pin: ${line.trim()}`);
      continue;
    }
    const [, action, reference, version] = match;
    usedActions.add(action);
    if (action.startsWith("./")) {
      continue;
    }
    const expected = ACTION_PINS[action];
    if (!/^[0-9a-f]{40}$/.test(reference)) {
      problems.push(`${action} must be pinned to a full immutable commit SHA`);
    }
    if (!expected) {
      problems.push(`${action} has no reviewed immutable pin`);
    } else if (reference !== expected.sha || version !== expected.version) {
      problems.push(`${action} must use ${expected.sha} # ${expected.version}`);
    }
  }
  for (const action of requiredActions) {
    if (!usedActions.has(action)) {
      problems.push(`Workflow is missing required pinned action ${action}`);
    }
  }
  return problems;
}

function stepWithCommand(steps, command) {
  return steps.findIndex((step) => runCommands(step).includes(command));
}

function allCommandIndexes(steps, command) {
  return steps.flatMap((step, index) => (
    runCommands(step).includes(command) ? [index] : []
  ));
}

function validateBuildAndBrowserChain(steps, kind) {
  const problems = [];
  const buildIndexes = allCommandIndexes(steps, "npm run build");
  const snapshotIndexes = allCommandIndexes(
    steps,
    "node scripts/attest-artifact.mjs snapshot",
  );
  const browserIndexes = allCommandIndexes(steps, "npm run test:e2e");
  const verifyIndexes = allCommandIndexes(
    steps,
    "node scripts/attest-artifact.mjs verify",
  );
  if (buildIndexes.length !== 1) {
    problems.push(`Workflow must build _site exactly once; found ${buildIndexes.length} builds`);
  }
  if (snapshotIndexes.length !== 1) {
    problems.push("Workflow must snapshot the built artifact exactly once");
  }
  if (browserIndexes.length !== 1) {
    problems.push("Workflow must run the built-artifact browser contract exactly once");
  }
  if (verifyIndexes.length < 1) {
    problems.push("Workflow must verify artifact bytes after browser tests");
  }
  if (problems.length > 0) {
    return problems;
  }

  const [buildIndex] = buildIndexes;
  const [snapshotIndex] = snapshotIndexes;
  const [browserIndex] = browserIndexes;
  if (!(buildIndex < snapshotIndex && snapshotIndex < browserIndex)) {
    problems.push("Build, attestation, and browser testing must occur in that order");
  }
  if (verifyIndexes[0] !== browserIndex + 1) {
    problems.push("Artifact bytes must be verified immediately after browser tests");
  }
  const chromiumIndex = stepWithCommand(steps, "npx playwright install --with-deps chromium");
  if (chromiumIndex < 0 || chromiumIndex > buildIndex) {
    problems.push("Chromium installation must finish before the single artifact build");
  }

  if (kind === "pages") {
    const uploadIndexes = steps.flatMap((step, index) => (
      actionUse(step)?.action === "actions/upload-pages-artifact" ? [index] : []
    ));
    if (uploadIndexes.length !== 1) {
      problems.push("Pages workflow must upload one and only one Pages artifact");
      return problems;
    }
    const [uploadIndex] = uploadIndexes;
    if (verifyIndexes.length !== 2 || verifyIndexes.at(-1) !== uploadIndex - 1) {
      problems.push("A second byte verification must run immediately before Pages upload");
    }
    const uploadStep = steps[uploadIndex];
    if (!uploadStep.lines.some((line) => /^\s*path:\s*_site\s*$/.test(line))) {
      problems.push("Pages upload must target the attested _site directory only");
    }
    for (let index = snapshotIndex + 1; index < uploadIndex; index += 1) {
      const commands = runCommands(steps[index]);
      const allowed = commands.length === 1 && [
        "npm run test:e2e",
        "node scripts/attest-artifact.mjs verify",
      ].includes(commands[0]);
      if (!allowed || actionUse(steps[index])) {
        problems.push(
          `Step "${steps[index].name}" may mutate the artifact between attestation and upload`,
        );
      }
    }
  }
  return problems;
}

export function workflowPolicyProblems(source, kind) {
  const steps = parseSteps(source);
  const requiredActions = kind === "pages"
    ? [
      "actions/checkout",
      "actions/setup-node",
      "actions/upload-pages-artifact",
      "actions/configure-pages",
      "actions/deploy-pages",
      "actions/download-artifact",
    ]
    : ["actions/checkout", "actions/setup-node"];
  const problems = [
    ...validateActionPins(source, requiredActions),
    ...validateBuildAndBrowserChain(steps, kind),
  ];
  if (source.includes("continue-on-error: true")) {
    problems.push("Release gates must not continue on error");
  }
  if (kind === "pages") {
    if (!/\n  deploy:\s*\n    needs:\s*validate\s*(?:\n|$)/.test(source)) {
      problems.push("Pages deploy job must require the attested validation job");
    }
    if (!/\n  verify-live:\s*\n    needs:\s*deploy\s*(?:\n|$)/.test(source)) {
      problems.push("Pages must require a post-deploy verify-live job");
    }
    if (!source.includes("node scripts/verify-live.mjs")) {
      problems.push("Pages post-deploy job must run the live hash verifier");
    }
    if (!source.includes("needs.deploy.outputs.page_url")) {
      problems.push("Live verification must use the URL emitted by the Pages deployment");
    }
    if (!source.includes("actions/download-artifact@")) {
      problems.push("Live verification must download the exact uploaded Pages artifact");
    }
    const uploadIndex = steps.findIndex(
      (step) => actionUse(step)?.action === "actions/upload-pages-artifact",
    );
    const deployIndex = steps.findIndex(
      (step) => actionUse(step)?.action === "actions/deploy-pages",
    );
    const liveIndex = stepWithCommand(steps, "node scripts/verify-live.mjs");
    if (!(uploadIndex >= 0 && uploadIndex < deployIndex && deployIndex < liveIndex)) {
      problems.push("Attested upload, Pages deployment, and live verification must stay ordered");
    }
  }
  return problems;
}

import type {
  BrowserAction,
  ElementDescriptor,
  EvidenceSummary,
  FrameworkInfo,
  ProposedFilePatch,
  RegressionCheck,
  RunConfig,
} from "@reform/shared";

interface FileContext {
  path: string;
  content: string;
}

interface ProposalResponse {
  rationale: string;
  confidence: number;
  target_files: string[];
  regression_checks: RegressionCheck[];
  patches: Array<{
    file_path: string;
    before: string;
    after: string;
    reason: string;
  }>;
}

class LlmResponseFormatError extends Error {
  constructor(message: string, readonly responseText: string) {
    super(message);
    this.name = "LlmResponseFormatError";
  }
}

function cleanJsonBlock(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    return trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  }
  return trimmed;
}

function findBalancedJsonObject(text: string) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start === -1) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
    }
  }

  return null;
}

function toStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function toRegressionChecks(value: unknown): RegressionCheck[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || typeof (entry as any).path !== "string") {
      return [];
    }

    return [
      {
        path: (entry as any).path,
        expectText: typeof (entry as any).expectText === "string" ? (entry as any).expectText : undefined,
      },
    ];
  });
}

function parseProposalResponse(outputText: string) {
  const sanitized = cleanJsonBlock(outputText);
  const candidates = [sanitized];
  const extracted = findBalancedJsonObject(sanitized);

  if (extracted && extracted !== sanitized) {
    candidates.push(extracted);
  }

  let parsed: unknown = null;
  let lastError: unknown = null;

  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch (error) {
      lastError = error;
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const preview = sanitized.slice(0, 240);
    const suffix = lastError instanceof Error ? ` ${lastError.message}` : "";
    throw new LlmResponseFormatError(
      `LLM returned non-JSON or malformed JSON instead of the required proposal object.${suffix} Response preview: ${preview}`,
      outputText,
    );
  }

  const proposal = parsed as Partial<ProposalResponse>;

  if (typeof proposal.rationale !== "string" || typeof proposal.confidence !== "number") {
    const preview = sanitized.slice(0, 240);
    throw new LlmResponseFormatError(
      `LLM JSON response was missing required proposal fields. Response preview: ${preview}`,
      outputText,
    );
  }

  return {
    rationale: proposal.rationale,
    confidence: proposal.confidence,
    target_files: toStringArray(proposal.target_files),
    regression_checks: toRegressionChecks(proposal.regression_checks),
    patches: Array.isArray(proposal.patches)
      ? proposal.patches.flatMap((patch) => {
          if (
            !patch ||
            typeof patch !== "object" ||
            typeof (patch as any).file_path !== "string" ||
            typeof (patch as any).before !== "string" ||
            typeof (patch as any).after !== "string" ||
            typeof (patch as any).reason !== "string"
          ) {
            return [];
          }

          return [
            {
              file_path: (patch as any).file_path,
              before: (patch as any).before,
              after: (patch as any).after,
              reason: (patch as any).reason,
            },
          ];
        })
      : [],
  } satisfies ProposalResponse;
}

function extractOpenAIOutputText(payload: any) {
  if (typeof payload?.output_text === "string" && payload.output_text.length > 0) {
    return payload.output_text;
  }

  const textParts: string[] = [];
  const output = Array.isArray(payload?.output) ? payload.output : [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === "string") {
        textParts.push(part.text);
      }
    }
  }

  return textParts.join("\n");
}

function extractChatOutputText(payload: any) {
  const choice = Array.isArray(payload?.choices) ? payload.choices[0] : null;
  const content = choice?.message?.content;

  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part?.text === "string" ? part.text : ""))
      .join("\n");
  }

  return "";
}

function buildPrompt(input: {
  config: RunConfig;
  evidence: EvidenceSummary;
  candidateFiles: FileContext[];
  currentUrl: string;
  framework?: FrameworkInfo | null;
}) {
  const frameworkHint = input.framework
    ? ` Detected framework: ${input.framework.name}${input.framework.metaFramework ? ` / ${input.framework.metaFramework}` : ""}${input.framework.version ? ` v${input.framework.version}` : ""}.`
    : "";

  const system = [
    "You are a senior frontend debugging agent.",
    "Return JSON only.",
    "Never include markdown fences, apologies, or explanatory text outside the JSON object.",
    "If you are uncertain, return a valid JSON object with empty patches and explain the constraint in rationale.",
    "You inspect a web project after a browser failure.",
    "Choose likely target files and propose exact string replacements.",
    "Only use before snippets that appear exactly in the provided file contents.",
    "Prefer minimal safe edits.",
    "Suggest a few regression checks relevant to the changed flow.",
    frameworkHint,
  ].join(" ");

  const user = {
    goal: input.config.goal,
    current_url: input.currentUrl,
    browser_actions: input.config.browserActions as BrowserAction[],
    evidence: input.evidence,
    candidate_files: input.candidateFiles.map((file) => ({
      path: file.path,
      content: file.content,
    })),
    response_schema: {
      rationale: "string",
      confidence: "number 0 to 1",
      target_files: ["string"],
      regression_checks: [{ path: "string", expectText: "string optional" }],
      patches: [
        {
          file_path: "string",
          before: "string",
          after: "string",
          reason: "string",
        },
      ],
    },
  };

  return {
    system,
    user: JSON.stringify(user),
  };
}

async function requestOpenAI(input: {
  config: RunConfig;
  evidence: EvidenceSummary;
  candidateFiles: FileContext[];
  currentUrl: string;
}) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const prompt = buildPrompt(input);
  const timeoutMs = Number(process.env.REFORM_LLM_TIMEOUT_MS ?? "180000");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.config.model,
      instructions: prompt.system,
      input: prompt.user,
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI request failed with ${response.status}.`);
  }

  const payload = await response.json();
  return extractOpenAIOutputText(payload);
}

async function requestZai(input: {
  config: RunConfig;
  evidence: EvidenceSummary;
  candidateFiles: FileContext[];
  currentUrl: string;
}) {
  const apiKey = process.env.ZAI_API_KEY;
  const baseUrl = process.env.ZAI_API_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4";

  if (!apiKey) {
    throw new Error("ZAI_API_KEY is not set.");
  }

  const prompt = buildPrompt(input);
  const timeoutMs = Number(process.env.REFORM_LLM_TIMEOUT_MS ?? "180000");

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: input.config.model,
      temperature: 0.1,
      messages: [
        {
          role: "system",
          content: prompt.system,
        },
        {
          role: "user",
          content: prompt.user,
        },
      ],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`z.ai request failed with ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  return extractChatOutputText(payload);
}

export async function proposePatchWithLlm(input: {
  config: RunConfig;
  evidence: EvidenceSummary;
  candidateFiles: FileContext[];
  currentUrl: string;
}) {
  const provider = (process.env.REFORM_LLM_PROVIDER ?? "openai").toLowerCase();

  const outputText =
    provider === "zai" ? await requestZai(input) : await requestOpenAI(input);

  const parsed = parseProposalResponse(outputText);

  const patches: ProposedFilePatch[] = parsed.patches.map((patch) => ({
    filePath: patch.file_path,
    before: patch.before,
    after: patch.after,
    reason: patch.reason,
    diff: "",
  }));

  return {
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    regressionChecks: parsed.regression_checks ?? [],
    targetFiles: parsed.target_files ?? [],
    patches,
  };
}

export async function proposeElementEditWithLlm(input: {
  config: RunConfig;
  element: ElementDescriptor;
  fileContent: string;
  filePath: string;
  customPrompt: string | null;
  currentUrl: string;
  framework?: FrameworkInfo | null;
}) {
  const frameworkLabel = input.framework
    ? `${input.framework.name}${input.framework.metaFramework ? ` / ${input.framework.metaFramework}` : ""}${input.framework.version ? ` v${input.framework.version}` : ""}`
    : "unknown";

  const system = [
    "You are a frontend UI editing agent.",
    "Return JSON only.",
    "Never include markdown fences, apologies, or explanatory text outside the JSON object.",
    "The user has selected a specific DOM element in their running app.",
    "Propose a minimal edit to the component source code that addresses the user's request.",
    "Only use before snippets that appear exactly in the provided file contents.",
    `Framework: ${frameworkLabel}`,
  ].join(" ");

  const user = {
    element: {
      tag: input.element.tagName,
      id: input.element.id,
      className: input.element.className,
      textContent: input.element.textContent,
      componentName: input.element.componentName,
      attributes: input.element.attributes,
    },
    sourceFile: {
      path: input.filePath,
      content: input.fileContent,
    },
    customPrompt: input.customPrompt || null,
    currentUrl: input.currentUrl,
    response_schema: {
      rationale: "string",
      confidence: "number 0 to 1",
      patches: [
        {
          file_path: "string",
          before: "string",
          after: "string",
          reason: "string",
        },
      ],
    },
  };

  const provider = (process.env.REFORM_LLM_PROVIDER ?? "openai").toLowerCase();
  const timeoutMs = Number(process.env.REFORM_LLM_TIMEOUT_MS ?? "180000");

  let outputText: string;

  if (provider === "zai") {
    const apiKey = process.env.ZAI_API_KEY;
    const baseUrl = process.env.ZAI_API_BASE_URL ?? "https://api.z.ai/api/coding/paas/v4";
    if (!apiKey) throw new Error("ZAI_API_KEY is not set.");

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: input.config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: system },
          { role: "user", content: JSON.stringify(user) },
        ],
      }),
    });
    if (!response.ok) throw new Error(`z.ai request failed with ${response.status}.`);
    const payload = await response.json();
    outputText = extractChatOutputText(payload);
  } else {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: input.config.model,
        instructions: system,
        input: JSON.stringify(user),
      }),
    });
    if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}.`);
    const payload = await response.json();
    outputText = extractOpenAIOutputText(payload);
  }

  const parsed = parseProposalResponse(outputText);

  const patches: ProposedFilePatch[] = parsed.patches.map((patch) => ({
    filePath: patch.file_path,
    before: patch.before,
    after: patch.after,
    reason: patch.reason,
    diff: "",
  }));

  return {
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    patches,
  };
}

export const __test__ = {
  cleanJsonBlock,
  findBalancedJsonObject,
  parseProposalResponse,
};

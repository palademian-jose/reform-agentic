import type {
  BrowserAction,
  ElementDescriptor,
  EvidenceSummary,
  FrameworkInfo,
  LlmProvider,
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

function escapeJsonControlCharsInStrings(text: string) {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }

      if (char === "\\") {
        result += char;
        escaped = true;
        continue;
      }

      if (char === "\"") {
        result += char;
        inString = false;
        continue;
      }

      if (char === "\n") {
        result += "\\n";
        continue;
      }

      if (char === "\r") {
        result += "\\r";
        continue;
      }

      if (char === "\t") {
        result += "\\t";
        continue;
      }

      const code = char.charCodeAt(0);
      if (code >= 0 && code < 0x20) {
        result += `\\u${code.toString(16).padStart(4, "0")}`;
        continue;
      }

      result += char;
      continue;
    }

    if (char === "\"") {
      inString = true;
    }

    result += char;
  }

  return result;
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

  for (const candidate of [...candidates]) {
    const repaired = escapeJsonControlCharsInStrings(candidate);
    if (repaired !== candidate) {
      candidates.push(repaired);
    }
  }

  let parsed: unknown = null;
  let lastError: unknown = null;

  for (const candidate of [...new Set(candidates)]) {
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

function normalizePromptText(value: string | null) {
  return String(value || "").trim().toLowerCase();
}

function isGenericLayoutPrompt(value: string | null) {
  const prompt = normalizePromptText(value);
  return [
    "change layout",
    "fix layout",
    "improve layout",
    "update layout",
    "adjust layout",
    "better layout",
    "layout",
  ].includes(prompt);
}

function buildEffectiveElementPrompt(input: {
  customPrompt: string | null;
  element: ElementDescriptor;
}) {
  if (!input.customPrompt) {
    return null;
  }

  if (!isGenericLayoutPrompt(input.customPrompt)) {
    return input.customPrompt;
  }

  const scopeLabel =
    input.element.componentName
      ? `${input.element.tagName} in ${input.element.componentName}`
      : input.element.tagName;

  return [
    `Change the layout of the selected ${scopeLabel}.`,
    "Treat the selected subtree as the edit boundary.",
    "Include the selected container and its child elements when adjusting structure, alignment, spacing, sizing, grid or flex behavior, and responsive layout.",
    "Preserve the existing content unless structural changes are required to produce a better layout.",
    "Make the edit directly in the code that renders this selected subtree.",
  ].join(" ");
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

async function requestOpenRouter(input: {
  config: RunConfig;
  evidence: EvidenceSummary;
  candidateFiles: FileContext[];
  currentUrl: string;
}) {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error("OPENROUTER_API_KEY is not set.");
  }

  const prompt = buildPrompt(input);
  const timeoutMs = Number(process.env.REFORM_LLM_TIMEOUT_MS ?? "180000");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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
    throw new Error(`OpenRouter request failed with ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  return extractChatOutputText(payload);
}

function getProviderSequence(config: RunConfig) {
  const primary = (config.llmProvider || "openrouter").toLowerCase() as LlmProvider;
  const fallback = config.llmFallbackProvider
    ? (config.llmFallbackProvider.toLowerCase() as LlmProvider)
    : null;

  return fallback && fallback !== primary ? [primary, fallback] : [primary];
}

async function requestWithProvider(
  provider: LlmProvider,
  input: {
    config: RunConfig;
    evidence: EvidenceSummary;
    candidateFiles: FileContext[];
    currentUrl: string;
  },
) {
  if (provider === "zai") {
    return await requestZai(input);
  }

  if (provider === "openrouter") {
    return await requestOpenRouter(input);
  }

  return await requestOpenAI(input);
}

async function requestElementEditWithProvider(
  provider: LlmProvider,
  input: {
    config: RunConfig;
    system: string;
    user: string;
  },
) {
  const timeoutMs = Number(process.env.REFORM_LLM_TIMEOUT_MS ?? "180000");

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
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`z.ai request failed with ${response.status}.`);
    const payload = await response.json();
    return extractChatOutputText(payload);
  }

  if (provider === "openrouter") {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OPENROUTER_API_KEY is not set.");

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: input.config.model,
        temperature: 0.1,
        messages: [
          { role: "system", content: input.system },
          { role: "user", content: input.user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter request failed with ${response.status}.`);
    const payload = await response.json();
    return extractChatOutputText(payload);
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: input.config.model,
      instructions: input.system,
      input: input.user,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed with ${response.status}.`);
  const payload = await response.json();
  return extractOpenAIOutputText(payload);
}

export async function proposePatchWithLlm(input: {
  config: RunConfig;
  evidence: EvidenceSummary;
  candidateFiles: FileContext[];
  currentUrl: string;
}) {
  const providers = getProviderSequence(input.config);
  let outputText = "";
  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      outputText = await requestWithProvider(provider, input);
      break;
    } catch (error) {
      lastError = error;
      if (provider === providers[providers.length - 1]) {
        throw error;
      }
    }
  }

  if (!outputText && lastError) {
    throw lastError;
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
  relatedFiles?: FileContext[];
  lineNumber?: number | null;
  focusedSnippet?: string;
  focusedStartLine?: number | null;
  focusedEndLine?: number | null;
  customPrompt: string | null;
  currentUrl: string;
  framework?: FrameworkInfo | null;
}) {
  const frameworkLabel = input.framework
    ? `${input.framework.name}${input.framework.metaFramework ? ` / ${input.framework.metaFramework}` : ""}${input.framework.version ? ` v${input.framework.version}` : ""}`
    : "unknown";

  const effectivePrompt = buildEffectiveElementPrompt({
    customPrompt: input.customPrompt,
    element: input.element,
  });

  // Prefer the resolver's focused JSX block. Fall back to a broader line-based excerpt.
  let codeContext = input.focusedSnippet?.trim() ?? "";
  const targetLine = input.lineNumber;
  if (!codeContext && targetLine && targetLine > 0) {
    const lines = input.fileContent.split("\n");
    const contextLines = 40; // Expanded from 15 to 40 lines for better context

    // Try to find function/component boundaries for cleaner context
    let startIdx = Math.max(0, targetLine - contextLines - 1);
    let endIdx = Math.min(lines.length, targetLine + contextLines);

    // Look backward for function/component start (export, function, const, class)
    for (let i = targetLine - 1; i >= Math.max(0, targetLine - contextLines - 1); i--) {
      const line = lines[i]?.trim();
      if (line?.startsWith("export") || line?.startsWith("function") ||
          line?.startsWith("const") || line?.startsWith("class") ||
          line?.match(/^const\s+\w+\s*=\s*\(/) || // const Component = (props)
          line?.match(/^const\s+\w+\s*=\s*async\s*\(/)) {
        startIdx = Math.max(0, i - 2); // Include a couple lines before the function start
        break;
      }
    }

    // Look forward for function/component end (closing brace at same or lower indent)
    let baseIndent = lines[targetLine - 1]?.match(/^\s*/)?.[0]?.length || 0;
    for (let i = targetLine; i < Math.min(lines.length, targetLine + contextLines); i++) {
      const line = lines[i];
      if ((line && line.trim() === "") || line?.trim().startsWith("}")) {
        const lineIndent = line.match(/^\s*/)?.[0]?.length || 0;
        if (line?.trim() === "}" && lineIndent <= baseIndent) {
          endIdx = Math.min(lines.length, i + 3); // Include a couple lines after
          break;
        }
      }
    }

    const snippetLines = lines.slice(startIdx, endIdx);
    codeContext = snippetLines.join("\n");
  }

  const candidateBeforeSnippets = [
    codeContext,
    codeContext.split("\n").slice(0, 12).join("\n").trim(),
    codeContext.split("\n").slice(-12).join("\n").trim(),
  ].filter((snippet, index, list) => snippet.length > 0 && list.indexOf(snippet) === index);

  const normalizedPrimaryPath = input.filePath.replace(/\\/g, "/");
  const normalizedRelatedFiles = (input.relatedFiles ?? []).map((file) => ({
    path: file.path.replace(/\\/g, "/"),
    content: file.content,
  }));

  const system = [
    "You are a frontend UI editing agent.",
    "Return JSON only.",
    "Never include markdown fences, apologies, or explanatory text outside the JSON object.",
    "The user has selected a specific DOM element in their running app.",
    "Propose a minimal edit to the component source code that addresses the user's request.",
    "The selected subtree includes the selected element and its child elements.",
    "Layout and structure changes should account for the full selected subtree, not only the top-level node.",
    "You may patch the primary source file or any provided related source file if that is where the selected UI is actually rendered.",
    "If the primary file is an app shell, router, or wrapper, prefer patching the more specific related page/component file that owns the selected UI.",
    "Only use before snippets that appear exactly in the provided file contents.",
    `Prefer patches in this file first: ${normalizedPrimaryPath}`,
    `Framework: ${frameworkLabel}`,
    "",
    "IMPORTANT: The element information includes:",
    "- outerHTML: The full HTML structure of the selected element including its children",
    "- innerHTML: The inner HTML content of the selected element",
    "- children: Array of direct child elements with their structure",
    "- childCount: Number of direct children",
    "- totalDescendants: Total number of descendant elements",
    "",
    "Use this structural information to understand the full context of what was selected.",
    "When editing, focus on the specific code that renders this structure.",
  ].join("\n");

  const user = {
    element: {
      tag: input.element.tagName,
      id: input.element.id,
      className: input.element.className,
      textContent: input.element.textContent,
      innerHTML: input.element.innerHTML,
      outerHTML: input.element.outerHTML,
      componentName: input.element.componentName,
      attributes: input.element.attributes,
      children: input.element.children,
      descendants: input.element.descendants,
      childCount: input.element.childCount,
      totalDescendants: input.element.totalDescendants,
    },
    sourceFile: {
      path: input.filePath,
      content: input.fileContent,
      ...(targetLine && codeContext ? {
        targetLine,
        codeContext: input.focusedStartLine && input.focusedEndLine
          ? `Lines ${input.focusedStartLine}-${input.focusedEndLine} (focused selected subtree):\n${codeContext}`
          : `Lines ${Math.max(1, targetLine - 40)}-${targetLine + 40} (approximate, expanded for context):\n${codeContext}`,
        allowedBeforeSnippets: candidateBeforeSnippets,
      } : {}),
    },
    relatedFiles: normalizedRelatedFiles,
    customPrompt: effectivePrompt,
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

  const providers = getProviderSequence(input.config);
  let outputText = "";
  let lastError: unknown = null;

  for (const provider of providers) {
    try {
      outputText = await requestElementEditWithProvider(provider, {
        config: input.config,
        system,
        user: JSON.stringify(user),
      });
      break;
    } catch (error) {
      lastError = error;
      if (provider === providers[providers.length - 1]) {
        throw error;
      }
    }
  }

  if (!outputText && lastError) {
    throw lastError;
  }

  const parseElementProposal = async (rawOutputText: string) => {
    try {
      return parseProposalResponse(rawOutputText);
    } catch (error) {
      if (!(error instanceof LlmResponseFormatError)) {
        throw error;
      }

      const malformedRetryUser = {
        ...user,
        retry_instruction:
          "Your previous response was not valid JSON. Return exactly one JSON object and nothing else. " +
          "Escape all newline characters inside string values as \\n. Do not use markdown fences. " +
          "Keep the same response schema and provide at least one valid patch if possible.",
      };
      const retryOutput = await requestElementEditWithProvider(providers[0], {
        config: input.config,
        system,
        user: JSON.stringify(malformedRetryUser),
      });
      return parseProposalResponse(retryOutput);
    }
  };

  let parsed = await parseElementProposal(outputText);
  const knownFileContents = new Map<string, string>([
    [normalizedPrimaryPath, input.fileContent],
    ...normalizedRelatedFiles.map((file) => [file.path, file.content] as const),
  ]);

  let patches = parsed.patches.map((patch) => ({
    filePath: patch.file_path.replace(/\\/g, "/"),
    before: patch.before,
    after: patch.after,
    reason: patch.reason,
    diff: "",
  })).map((patch) => {
    const directContent = knownFileContents.get(patch.filePath);
    if (directContent?.includes(patch.before)) {
      return patch;
    }

    const matchingFiles = [...knownFileContents.entries()]
      .filter(([, content]) => content.includes(patch.before))
      .map(([filePath]) => filePath);

    if (matchingFiles.length === 1) {
      return { ...patch, filePath: matchingFiles[0] };
    }

    if (input.fileContent.includes(patch.before)) {
      return { ...patch, filePath: normalizedPrimaryPath };
    }

    return patch;
  }).filter((patch) => {
    const content = knownFileContents.get(patch.filePath);
    return content ? content.includes(patch.before) : false;
  });

  let retryReason = '';
  if (patches.length === 0) {
    const invalidCount = parsed.patches.length;
    if (invalidCount > 0) {
      retryReason = `All ${invalidCount} proposed patches had invalid 'before' snippets (not found in file).`;
    }
  }

  // Retry if empty and customPrompt
  if (patches.length === 0) {
    console.log(`${retryReason || "Empty patches from custom prompt"}—retrying with refined instructions:`, effectivePrompt);
    const refinedUser = {
      ...user,
      retry_instruction:
        `Use the focused selected-subtree context first. Every "before" must be copied verbatim from sourceFile.content, preferably from sourceFile.allowedBeforeSnippets. ` +
        `${retryReason || "The previous draft did not match the file exactly."} ` +
        `If changing layout, include the related child elements inside the same selected subtree. Provide at least one valid patch.`,
    };
    const retryOutput = await requestElementEditWithProvider(providers[0], {  // Use first provider for retry
      config: input.config,
      system,
      user: JSON.stringify(refinedUser),
    });
    const retryParsed = parseProposalResponse(retryOutput);
    const retryPatches = retryParsed.patches.map((patch) => ({
      filePath: patch.file_path.replace(/\\/g, "/"),
      before: patch.before,
      after: patch.after,
      reason: patch.reason,
      diff: "",
    })).map((patch) => (
      input.fileContent.includes(patch.before)
        ? { ...patch, filePath: normalizedPrimaryPath }
        : patch
    )).filter((patch) => {
      if (patch.filePath === normalizedPrimaryPath) {
        return input.fileContent.includes(patch.before);
      }
      return true;
    });
    if (retryPatches.length > 0) {
      parsed = retryParsed;
      patches = retryPatches;
    }
  }

  console.log(`${retryReason ? "After validation: " : ""}Parsed ${patches.length} patches from custom prompt: ${effectivePrompt?.substring(0, 80) || "none"}`);

  return {
    confidence: parsed.confidence,
    rationale: parsed.rationale,
    patches,
  };
}

export const __test__ = {
  cleanJsonBlock,
  escapeJsonControlCharsInStrings,
  findBalancedJsonObject,
  parseProposalResponse,
};

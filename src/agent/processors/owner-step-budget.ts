import type {
  ProcessInputStepArgs,
  ProcessInputStepResult,
  Processor,
} from "@mastra/core/processors";
import { TOOL_ERROR_COUNT_KEY } from "../tools/error-tagging.js";
import { logger } from "../../utils/external-logger.js";

interface OwnerStepBudgetOptions {
  maxToolsPerStep?: number;
  maxToolsPerTurn?: number;
  maxTokensPerStep?: number;
  maxTokensPerTurn?: number;
  enforceFinalSummaryStep?: boolean;
  /** Skip the chatType === "owner" guard. Use for sub-agents. */
  alwaysActive?: boolean;
  /** Soft-warn when cumulative tokens exceed this threshold. Default: 150_000. */
  tokenBudgetSoftWarn?: number;
  /** Hard-stop when cumulative tokens exceed this threshold. Default: 350_000. */
  tokenBudgetHardStop?: number;
}

/**
 * Keeps owner-mode runs bounded even when a model emits aggressive tool plans.
 *
 * This does not disable parallel tools globally. It enforces a hard budget
 * for follow-up steps:
 * - If the previous step exceeded per-step budget, no more tools this turn.
 * - If total tools already reached turn budget, no more tools this turn.
 * - If cumulative turn tokens reached the token budget, no more tools this turn.
 */
export class OwnerStepBudgetProcessor implements Processor {
  readonly id = "owner-step-budget";
  readonly name = "Owner Step Budget";

  private readonly maxToolsPerStep: number;
  private readonly maxToolsPerTurn: number | null;
  private readonly maxTokensPerStep: number;
  private readonly maxTokensPerTurn: number;
  private readonly enforceFinalSummaryStep: boolean;
  private readonly alwaysActive: boolean;
  private readonly tokenBudgetSoftWarn: number;
  private readonly tokenBudgetHardStop: number;

  constructor(options: OwnerStepBudgetOptions = {}) {
    this.maxToolsPerStep = options.maxToolsPerStep ?? 4;
    this.maxToolsPerTurn =
      typeof options.maxToolsPerTurn === "number" && Number.isFinite(options.maxToolsPerTurn)
        ? options.maxToolsPerTurn
        : null;
    this.maxTokensPerStep = options.maxTokensPerStep ?? 18_000;
    this.maxTokensPerTurn = options.maxTokensPerTurn ?? 60_000;
    this.enforceFinalSummaryStep = options.enforceFinalSummaryStep ?? true;
    this.alwaysActive = options.alwaysActive ?? false;
    this.tokenBudgetSoftWarn = options.tokenBudgetSoftWarn ?? 150_000;
    this.tokenBudgetHardStop = options.tokenBudgetHardStop ?? 350_000;
  }

  processInputStep(args: ProcessInputStepArgs): ProcessInputStepResult | void {
    if (!this.alwaysActive) {
      const chatType = args.requestContext?.get("chatType" as never) as
        | string
        | undefined;
      if (chatType !== "owner") {
        return;
      }
    }

    // Track steps ourselves since Mastra doesn't populate args.steps reliably.
    // Use the processor's custom state which persists across steps within a turn.
    const state = (args as { state?: Record<string, unknown> }).state ?? {};
    const stepNumber = (args as { stepNumber?: number }).stepNumber ?? 0;

    // On step 0, nothing to check
    if (stepNumber === 0) {
      state._stepCount = 1;
      state._consecutiveEmpty = 0;
      return;
    }

    // Check the messages for evidence of what the previous step produced.
    // If the last assistant message has no tool calls and no meaningful text,
    // it was an empty step.
    const messages = Array.isArray(args.messages) ? args.messages : [];
    const lastAssistant = [...messages].reverse().find(m => m.role === "assistant");
    const lastWasEmpty = lastAssistant ? this.isEmptyAssistantMessage(lastAssistant) : false;

    const consecutiveEmpty = lastWasEmpty
      ? ((state._consecutiveEmpty as number) || 0) + 1
      : 0;
    state._consecutiveEmpty = consecutiveEmpty;
    state._stepCount = ((state._stepCount as number) || 0) + 1;

    const steps = Array.isArray(args.steps) ? args.steps : [];
    let totalToolCalls = 0;
    let totalTokens = 0;
    for (const step of steps) {
      const calls = this.extractToolCalls(step);
      totalToolCalls += calls.length;
      totalTokens += this.extractStepTokens(step);
    }

    // ── Token budget: hard stop ──
    if (totalTokens >= this.tokenBudgetHardStop) {
      console.log(`[step-budget] TOKEN HARD STOP at ${totalTokens} tokens (limit ${this.tokenBudgetHardStop})`);
      logger.warn(`Token budget HARD STOP: ${totalTokens} tokens`, { tokens: String(totalTokens), limit: String(this.tokenBudgetHardStop) });
      return {
        tools: {},
        activeTools: [],
        toolChoice: "none",
        systemMessages: [
          ...args.systemMessages,
          {
            role: "system" as const,
            content:
              `You have used ${totalTokens} tokens this run, reaching the ${this.tokenBudgetHardStop} token budget. ` +
              "Do not call any more tools. Write your best answer using all the information you have gathered so far. " +
              "If your research is incomplete, say so and summarize what you found. Do not apologize excessively — just deliver the results.",
          },
        ],
      };
    }

    // ── Token budget: soft warning ──
    if (totalTokens >= this.tokenBudgetSoftWarn && !state._tokenSoftWarned) {
      state._tokenSoftWarned = true;
      console.log(`[step-budget] token soft warn at ${totalTokens} tokens (threshold ${this.tokenBudgetSoftWarn})`);
      logger.info(`Token budget soft warn: ${totalTokens} tokens`, { tokens: String(totalTokens), threshold: String(this.tokenBudgetSoftWarn) });
      return {
        systemMessages: [
          ...args.systemMessages,
          {
            role: "system" as const,
            content:
              `You have used ${totalTokens} tokens so far (budget: ${this.tokenBudgetHardStop}). ` +
              "If you are working on a complex task (deep research, multi-step analysis), evaluate whether you have enough information to answer. " +
              "Continue if you genuinely need more data. Start wrapping up if you have what you need.",
          },
        ],
      };
    }

    const lastStepCalls = steps.length > 0 ? this.extractToolCalls(steps[steps.length - 1]).length : 0;
    const lastStepTokens = steps.length > 0 ? this.extractStepTokens(steps[steps.length - 1]) : 0;
    const maxSteps = this.toFiniteNumber(
      args.requestContext?.get("maxSteps" as never),
    );
    const forceFinalSummaryStep =
      this.enforceFinalSummaryStep &&
      maxSteps !== null &&
      maxSteps > 0 &&
      stepNumber >= maxSteps - 1;

    const exceededStepBudget = lastStepCalls > this.maxToolsPerStep;
    const exceededStepTokenBudget = lastStepTokens >= this.maxTokensPerStep;
    const exceededTurnBudget =
      this.maxToolsPerTurn !== null && totalToolCalls >= this.maxToolsPerTurn;
    const exceededTokenBudget = totalTokens >= this.maxTokensPerTurn;

    // Detect empty-response loop using our own tracking (not args.steps)
    const emptyStepLoop = consecutiveEmpty >= 1;

    // ── Budget awareness: soft warning at 40% of steps, hard cap at 70% ──
    const budgetFraction = maxSteps && maxSteps > 0 ? stepNumber / maxSteps : 0;
    const softWarningThreshold = 0.4;  // ~step 20 of 50
    const hardCapThreshold = 0.7;      // ~step 35 of 50

    // Read error count from requestContext
    const errorCount = (args.requestContext?.get(TOOL_ERROR_COUNT_KEY) as number) || 0;
    const errorContext = errorCount > 0 ? ` You have encountered ${errorCount} tool error${errorCount > 1 ? "s" : ""} so far.` : "";

    // Hard cap: strip tools entirely at 70% of budget
    if (budgetFraction >= hardCapThreshold && maxSteps) {
      console.log(`[step-budget] HARD CAP at step ${stepNumber}/${maxSteps} (${Math.round(budgetFraction * 100)}%, ${errorCount} errors) — forcing final answer`);
      logger.warn(`Step budget HARD CAP: step ${stepNumber}/${maxSteps}, ${errorCount} errors`, { step: String(stepNumber), maxSteps: String(maxSteps), errors: String(errorCount) });
      return {
        tools: {},
        activeTools: [],
        toolChoice: "none",
        systemMessages: [
          ...args.systemMessages,
          {
            role: "system" as const,
            content:
              `Step ${stepNumber} of ${maxSteps}.${errorContext} ` +
              "You are likely stuck in a spiral and cannot complete this task. " +
              "STOP. Do not call any more tools. Tell the user what you tried, what failed, and what they can do instead.",
          },
        ],
      };
    }

    // Soft warning: inject guidance at 40% of budget (tools still available)
    if (budgetFraction >= softWarningThreshold && maxSteps && !state._softWarningInjected) {
      state._softWarningInjected = true;
      console.log(`[step-budget] soft warning at step ${stepNumber}/${maxSteps} (${Math.round(budgetFraction * 100)}%, ${errorCount} errors)`);
      logger.warn(`Step budget soft warning: step ${stepNumber}/${maxSteps}, ${errorCount} errors`, { step: String(stepNumber), maxSteps: String(maxSteps), errors: String(errorCount) });
      const warningMessages = [
        ...args.systemMessages,
        {
          role: "system" as const,
          content:
            `You have used ${stepNumber} of ${maxSteps} steps.${errorContext} ` +
            "If you're hitting errors or not finding what you need, this is likely a task you cannot complete. " +
            "Either respond with what you have or tell the user you're unable to complete the request.",
        },
      ];
      // Don't strip tools — just warn
      return { systemMessages: warningMessages };
    }

    if (
      !forceFinalSummaryStep &&
      !exceededStepBudget &&
      !exceededStepTokenBudget &&
      !exceededTurnBudget &&
      !exceededTokenBudget &&
      !emptyStepLoop
    ) {
      return;
    }

    const reasons: string[] = [];
    if (forceFinalSummaryStep) {
      reasons.push(
        `next step is final step (${stepNumber + 1}/${maxSteps}); reserve it for a final answer`,
      );
    }
    if (exceededStepBudget) {
      reasons.push(
        `previous step used ${lastStepCalls} tools (limit ${this.maxToolsPerStep})`,
      );
    }
    if (exceededStepTokenBudget) {
      reasons.push(
        `previous step used ${lastStepTokens} tokens (limit ${this.maxTokensPerStep})`,
      );
    }
    if (exceededTurnBudget) {
      reasons.push(
        `turn used ${totalToolCalls} tools (limit ${String(this.maxToolsPerTurn)})`,
      );
    }
    if (exceededTokenBudget) {
      reasons.push(`turn used ${totalTokens} tokens (limit ${this.maxTokensPerTurn})`);
    }
    if (emptyStepLoop) {
      console.log(`[step-budget] empty step detected at step ${stepNumber} (${consecutiveEmpty} consecutive) — forcing final answer`);
      reasons.push(`empty-response loop detected (${consecutiveEmpty} consecutive empty steps). Write your final answer NOW.`);
    }

    const systemMessages = [
      ...args.systemMessages,
      {
        role: "system" as const,
        content:
          `Tool budget reached: ${reasons.join("; ")}. ` +
          "Do not call more tools in this turn. Provide the best final answer from available results and clearly state any missing data.",
      },
    ];

    return {
      tools: {},
      activeTools: [],
      toolChoice: "none",
      systemMessages,
    };
  }

  private extractToolCalls(step: unknown): unknown[] {
    if (!step || typeof step !== "object") {
      return [];
    }
    const calls = (step as { toolCalls?: unknown }).toolCalls;
    return Array.isArray(calls) ? calls : [];
  }

  private extractStepTokens(step: unknown): number {
    if (!step || typeof step !== "object") {
      return 0;
    }

    const usage = (step as { usage?: Record<string, unknown> }).usage;
    if (!usage || typeof usage !== "object") {
      return 0;
    }

    const total = this.toFiniteNumber(
      usage.totalTokens ?? usage.total_tokens ?? usage.tokens,
    );
    if (total !== null) {
      return total;
    }

    const prompt = this.toFiniteNumber(
      usage.promptTokens ?? usage.inputTokens ?? usage.prompt_tokens,
    );
    const completion = this.toFiniteNumber(
      usage.completionTokens ?? usage.outputTokens ?? usage.completion_tokens,
    );

    return (prompt ?? 0) + (completion ?? 0);
  }

  /**
   * Check if an assistant message is "empty" — no tool calls and no meaningful text.
   * This is checked on the messages array directly since args.steps is unreliable.
   */
  private isEmptyAssistantMessage(msg: unknown): boolean {
    if (!msg || typeof msg !== "object") return true;
    const record = msg as Record<string, unknown>;

    // Check for tool calls
    const toolCalls = record.toolCalls ?? record.tool_calls;
    if (Array.isArray(toolCalls) && toolCalls.length > 0) return false;

    // Check content for tool invocations or text
    const content = record.content;
    if (typeof content === "string") return !content.trim();

    if (content && typeof content === "object") {
      const parts = (content as { parts?: unknown[] }).parts;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          const p = part as { type?: string; text?: string };
          if (p.type === "tool-invocation" || p.type === "tool-call") return false;
          if (p.type === "text" && p.text?.trim()) return false;
        }
      }
    }

    return true;
  }

  private extractStepText(step: unknown): string {
    if (!step || typeof step !== "object") return "";
    const text = (step as { text?: unknown }).text;
    if (typeof text === "string") return text.trim();
    const response = (step as { response?: { text?: unknown } }).response;
    if (response && typeof response.text === "string") return response.text.trim();
    return "";
  }

  private toFiniteNumber(value: unknown): number | null {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  }
}

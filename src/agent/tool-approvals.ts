import type { RequestContext } from "@mastra/core/request-context";
import type { MessageTransport } from "../transport/index.js";
import type { ChatAddress } from "../transport/types.js";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { logger } from "../utils/external-logger.js";
import { dataPath } from "../utils/paths.js";

export type PendingApprovalStatus = "pending" | "approved" | "denied" | "executed" | "expired";

export interface PendingToolApproval {
  id: string;
  toolName: string;
  input: unknown;
  summary: string;
  jid: string;
  platform: string;
  createdAt: number;
  expiresAt: number;
  status: PendingApprovalStatus;
}

export interface ApprovalButtonAction {
  action: "approve" | "deny";
  id: string;
}

const APPROVAL_DIR = dataPath("tool-approvals");
const APPROVAL_TTL_MS = 15 * 60_000;
const BUTTON_TEXT_RE = /^(?:\[Button:\s*)?(approve|deny):([a-f0-9-]+)\]?$/i;

function ensureApprovalDir(): void {
  fs.mkdirSync(APPROVAL_DIR, { recursive: true });
}

function approvalPath(id: string): string {
  return path.join(APPROVAL_DIR, `${id}.json`);
}

function normalizeStatus(record: PendingToolApproval): PendingToolApproval {
  if (record.status === "pending" && Date.now() > record.expiresAt) {
    try { logger.warn(`Tool approval timeout: ${record.toolName}`, { tool: record.toolName, approvalId: record.id }); } catch { /* ignore */ }
    return { ...record, status: "expired" };
  }
  return record;
}

export function isApprovalBypassed(requestContext?: RequestContext): boolean {
  return Boolean(requestContext?.get("approvalBypass" as never));
}

export function parseApprovalButtonText(text: string): ApprovalButtonAction | null {
  const match = text.trim().match(BUTTON_TEXT_RE);
  if (!match) return null;
  return {
    action: match[1].toLowerCase() as "approve" | "deny",
    id: match[2],
  };
}

export function createPendingToolApproval(params: {
  toolName: string;
  input: unknown;
  summary: string;
  jid: string;
  platform: string;
}): PendingToolApproval {
  ensureApprovalDir();
  const createdAt = Date.now();
  const record: PendingToolApproval = {
    id: randomUUID(),
    toolName: params.toolName,
    input: params.input,
    summary: params.summary,
    jid: params.jid,
    platform: params.platform,
    createdAt,
    expiresAt: createdAt + APPROVAL_TTL_MS,
    status: "pending",
  };
  fs.writeFileSync(approvalPath(record.id), JSON.stringify(record, null, 2), "utf-8");
  try { logger.info(`Tool approval requested: ${record.toolName}`, { tool: record.toolName, approvalId: record.id, platform: record.platform }); } catch { /* ignore */ }
  return record;
}

export function loadPendingToolApproval(id: string): PendingToolApproval | null {
  const filePath = approvalPath(id);
  if (!fs.existsSync(filePath)) return null;

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(raw) as PendingToolApproval;
    const normalized = normalizeStatus(parsed);
    if (normalized.status !== parsed.status) {
      savePendingToolApproval(normalized);
    }
    return normalized;
  } catch {
    return null;
  }
}

export function savePendingToolApproval(record: PendingToolApproval): void {
  ensureApprovalDir();
  fs.writeFileSync(approvalPath(record.id), JSON.stringify(record, null, 2), "utf-8");
}

export function updatePendingToolApprovalStatus(
  id: string,
  status: PendingApprovalStatus,
): PendingToolApproval | null {
  const record = loadPendingToolApproval(id);
  if (!record) return null;
  const updated = { ...record, status };
  savePendingToolApproval(updated);
  const logLevel = status === "denied" || status === "expired" ? "warn" : "info";
  try { logger[logLevel](`Tool approval ${status}: ${record.toolName}`, { tool: record.toolName, approvalId: id, status }); } catch { /* ignore */ }
  return updated;
}

function buildApprovalAddress(transport: MessageTransport, jid: string, threadId?: string): ChatAddress {
  return { platform: transport.platform, id: jid, ...(threadId ? { threadId } : {}) };
}

function buildApprovalText(record: PendingToolApproval): string {
  return [
    "Approval needed",
    "",
    record.summary,
    "",
    "This request expires in 15 minutes.",
  ].join("\n");
}

// Track pending approvals per turn to avoid spamming
const turnPendingApprovals = new WeakMap<object, string>();

export async function requestToolApproval(params: {
  requestContext?: RequestContext;
  toolName: string;
  input: unknown;
  summary: string;
}): Promise<string | null> {
  const requestContext = params.requestContext;
  if (!requestContext || isApprovalBypassed(requestContext)) {
    return null;
  }

  // Deduplicate: if an approval was already requested this turn, don't spam another
  const existingApprovalId = turnPendingApprovals.get(requestContext);
  if (existingApprovalId) {
    return `Approval already requested (${existingApprovalId}). Stop and wait for the user to approve or deny.`;
  }

  const transport = requestContext.get("transport" as never) as MessageTransport | undefined;
  const jid = requestContext.get("jid" as never) as string | undefined;
  if (!transport || !jid) {
    return null;
  }

  const record = createPendingToolApproval({
    toolName: params.toolName,
    input: params.input,
    summary: params.summary,
    jid,
    platform: transport.platform,
  });

  // Mark this turn as having a pending approval
  turnPendingApprovals.set(requestContext, record.id);

  const address = buildApprovalAddress(transport, jid);
  const approvalText = buildApprovalText(record);

  if (transport.sendTextWithButtons) {
    await transport.sendTextWithButtons(address, approvalText, [
      { label: "Approve", callbackData: `approve:${record.id}` },
      { label: "Deny", callbackData: `deny:${record.id}` },
    ]);
  } else {
    await transport.sendText(
      address,
      `${approvalText}\n\nReply with "approve:${record.id}" or "deny:${record.id}".`,
    );
  }

  // __approvalPending flag REMOVED — it was leaking from sub-agents to parent
  // via shared requestContext, causing the primary agent to eat real responses.
  // The tool return value ("Do not send any additional message") handles suppression via prompt.

  return `Approval requested and sent to the owner. Do not send any additional message — the approval card is already visible. Stop here.`;
}

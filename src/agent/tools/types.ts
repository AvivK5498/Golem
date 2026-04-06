import type { JobQueue } from "../../scheduler/job-queue.js";
import type { MessageTransport } from "../../transport/index.js";

/**
 * Shape of the requestContext values that the agent layer sets before
 * invoking tools. Each tool reads the subset it needs via context.requestContext.get().
 */
export interface ToolRequestContext {
  transport: MessageTransport;
  jobQueue?: JobQueue;
  jid?: string; // current chat JID, used by run_workflow async for target_jid injection
  imageFilePath?: string; // file path of image attached to current message
  chatType?: string;
  promptMode?: string;
  senderId?: string;
  senderDisplayName?: string;
  senderPlatform?: string;
}

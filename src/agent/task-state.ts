// ---------------------------------------------------------------------------
// Per-process, per-thread in-memory task state for multi-step task tracking.
// Map keyed by threadId (jid). Entries auto-evict after TTL_MS of inactivity.
// ---------------------------------------------------------------------------

const TTL_MS = 30 * 60 * 1000; // 30 minutes

export interface TaskItem {
  content: string;
  status: "pending" | "in_progress" | "completed";
  activeForm: string;
}

export interface TaskState {
  tasks: TaskItem[];
  updatedAt: number;
}

const store = new Map<string, TaskState>();

/** Replace the full task list for a thread. */
export function setTaskState(threadId: string, tasks: TaskItem[]): void {
  store.set(threadId, { tasks, updatedAt: Date.now() });
}

/** Get the current task state, or undefined if expired/missing. */
export function getTaskState(threadId: string): TaskState | undefined {
  const state = store.get(threadId);
  if (!state) return undefined;
  if (Date.now() - state.updatedAt > TTL_MS) {
    store.delete(threadId);
    return undefined;
  }
  return state;
}

/** Clear task state for a thread. */
export function clearTaskState(threadId: string): void {
  store.delete(threadId);
}

/**
 * Format the current task list as an XML-tagged block for system prompt injection.
 * Returns empty string if no active tasks.
 */
export function formatTaskList(threadId: string): string {
  const state = getTaskState(threadId);
  if (!state || state.tasks.length === 0) return "";

  const lines = state.tasks.map((t, i) => {
    const marker =
      t.status === "completed" ? "[x]" :
      t.status === "in_progress" ? "[~]" :
      "[ ]";
    return `${i + 1}. ${marker} ${t.content}${t.activeForm ? ` (${t.activeForm})` : ""}`;
  });

  return `\n\n<task_list>\n${lines.join("\n")}\n</task_list>`;
}

/** Evict all expired entries. Called opportunistically. */
export function evictExpired(): void {
  const now = Date.now();
  for (const [key, state] of store) {
    if (now - state.updatedAt > TTL_MS) {
      store.delete(key);
    }
  }
}

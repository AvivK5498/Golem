import type { HookName, HookContext, HookHandler, HookResult } from "./types.js";

export class HookRegistry {
  private handlers = new Map<HookName, HookHandler[]>();

  register(hook: HookName, handler: HookHandler): () => void {
    const list = this.handlers.get(hook) || [];
    list.push(handler);
    this.handlers.set(hook, list);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  async emit(hook: HookName, ctx: HookContext): Promise<HookResult> {
    const list = this.handlers.get(hook) || [];
    let aggregated: HookResult = undefined;

    for (const handler of list) {
      try {
        const result = await handler(ctx);
        if (result?.skip) return result;
        if (result?.modifiedText) {
          ctx.text = result.modifiedText;
          aggregated = result;
        }
        if (result?.modifiedResult) {
          aggregated = result;
        }
      } catch (err) {
        console.error(`[hooks] ${hook} handler error:`, err instanceof Error ? err.message : err);
      }
    }
    return aggregated;
  }

  emitSync(hook: HookName, ctx: HookContext): void {
    const list = this.handlers.get(hook) || [];
    for (const handler of list) {
      Promise.resolve(handler(ctx)).catch((err) => {
        console.error(`[hooks] ${hook} handler error:`, err instanceof Error ? err.message : err);
      });
    }
  }

  getRegisteredHooks(): HookName[] {
    return [...this.handlers.keys()];
  }

  getHandlerCount(hook: HookName): number {
    return (this.handlers.get(hook) || []).length;
  }
}

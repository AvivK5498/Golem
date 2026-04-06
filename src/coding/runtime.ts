export interface CodingResult {
  success: boolean;
  output: string;
  durationMs: number;
  agent: string;
}

/** Called with progress updates during long-running coding tasks. */
export type ProgressCallback = (message: string) => void;

export interface CodingRuntime {
  readonly name: string;
  execute(task: string, cwd: string, onProgress?: ProgressCallback, model?: string): Promise<CodingResult>;
  isAvailable(): Promise<boolean>;
}

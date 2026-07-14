import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { AuditEntry } from "../shared/contracts";

export class AuditService {
  private readonly filePath: string;

  constructor(dataDirectory: string) {
    this.filePath = path.join(dataDirectory, "audit.jsonl");
  }

  async write(entry: Omit<AuditEntry, "timestamp">): Promise<void> {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    await appendFile(
      this.filePath,
      `${JSON.stringify({ timestamp: new Date().toISOString(), ...entry })}\n`,
      "utf8",
    );
  }

  async list(): Promise<AuditEntry[]> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return raw
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line) as AuditEntry)
        .slice(-200)
        .reverse();
    } catch {
      return [];
    }
  }
}

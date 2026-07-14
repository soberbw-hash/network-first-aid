import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import type { RawNetworkSnapshot, SnapshotSummary } from "../shared/contracts";
import { AuditService } from "./audit";
import { DiagnosticsService } from "./diagnostics";

interface StoredSnapshot {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  reason: string;
  raw: RawNetworkSnapshot;
}

const SNAPSHOT_ID_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/;

const makeId = (): string => new Date().toISOString().replaceAll(":", "-").replace(".", "-");

export class SnapshotService {
  readonly directory: string;

  constructor(
    dataDirectory: string,
    private readonly diagnostics: DiagnosticsService,
    private readonly audit: AuditService,
  ) {
    this.directory = path.join(dataDirectory, "snapshots");
  }

  resolveDirectory(id: string): string {
    if (!SNAPSHOT_ID_PATTERN.test(id)) throw new Error("快照编号无效");
    return path.join(this.directory, id);
  }

  async create(reason = "手动备份"): Promise<SnapshotSummary> {
    const id = makeId();
    const createdAt = new Date().toISOString();
    const snapshotDirectory = this.resolveDirectory(id);
    await mkdir(snapshotDirectory, { recursive: true });
    const raw = await this.diagnostics.captureRawSnapshot();
    const stored: StoredSnapshot = { schemaVersion: 1, id, createdAt, reason: reason.slice(0, 160), raw };
    const snapshotPath = path.join(snapshotDirectory, "snapshot.json");
    await writeFile(snapshotPath, JSON.stringify(stored, null, 2), "utf8");

    const hostsPath = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "drivers", "etc", "hosts");
    try {
      await copyFile(hostsPath, path.join(snapshotDirectory, "hosts"));
    } catch {
      // Hosts may be locked by security software; the structured snapshot remains usable.
    }

    const sizeBytes = await this.directorySize(snapshotDirectory);
    await this.audit.write({
      kind: "backup",
      title: "已创建网络快照",
      detail: `${reason} · ${id}`,
      success: true,
    });
    return { id, createdAt, reason: stored.reason, computerName: raw.computerName, sizeBytes };
  }

  async read(id: string): Promise<StoredSnapshot> {
    const raw = await readFile(path.join(this.resolveDirectory(id), "snapshot.json"), "utf8");
    const snapshot = JSON.parse(raw) as StoredSnapshot;
    if (snapshot.schemaVersion !== 1 || snapshot.id !== id) throw new Error("快照格式不受支持");
    return snapshot;
  }

  async list(): Promise<SnapshotSummary[]> {
    await mkdir(this.directory, { recursive: true });
    const entries = await readdir(this.directory, { withFileTypes: true });
    const summaries = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory() && SNAPSHOT_ID_PATTERN.test(entry.name))
        .map(async (entry): Promise<SnapshotSummary | undefined> => {
          try {
            const stored = await this.read(entry.name);
            return {
              id: stored.id,
              createdAt: stored.createdAt,
              reason: stored.reason,
              computerName: stored.raw.computerName,
              sizeBytes: await this.directorySize(this.resolveDirectory(entry.name)),
            };
          } catch {
            return undefined;
          }
        }),
    );
    return summaries
      .filter((summary): summary is SnapshotSummary => Boolean(summary))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async remove(id: string): Promise<void> {
    await rm(this.resolveDirectory(id), { recursive: true, force: true });
  }

  private async directorySize(directory: string): Promise<number> {
    let total = 0;
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      total += entry.isDirectory() ? await this.directorySize(target) : (await stat(target)).size;
    }
    return total;
  }
}

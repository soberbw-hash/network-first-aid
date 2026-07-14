import { execFile } from "node:child_process";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

const execFileAsync = promisify(execFile);

const POWERSHELL_PREFIX = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$InformationPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
`;

export const escapePowerShellSingleQuoted = (value: string): string => value.replaceAll("'", "''");

export const runPowerShell = async (
  script: string,
  timeoutMs = 45_000,
): Promise<string> => {
  if (process.platform !== "win32") throw new Error("网络急救箱目前仅支持 Windows");
  const encoded = Buffer.from(`${POWERSHELL_PREFIX}\n${script}`, "utf16le").toString("base64");
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
    { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: "utf8" },
  );
  return stdout.replace(/^\uFEFF/, "").trim();
};

interface ElevatedResult {
  success: boolean;
  logs: string[];
  error?: string;
}

export const runElevatedPowerShell = async (
  body: string,
  jobsDirectory: string,
  timeoutMs = 180_000,
): Promise<ElevatedResult> => {
  const jobId = randomUUID();
  const jobDirectory = path.join(jobsDirectory, jobId);
  const scriptPath = path.join(jobDirectory, "action.ps1");
  const resultPath = path.join(jobDirectory, "result.json");
  await mkdir(jobDirectory, { recursive: true });

  const resultLiteral = escapePowerShellSingleQuoted(resultPath);
  const wrapped = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$logs = [System.Collections.Generic.List[string]]::new()
function Add-Log([string]$message) { $logs.Add($message) }
try {
${body}
  [ordered]@{ success = $true; logs = @($logs); error = $null } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath '${resultLiteral}' -Encoding UTF8
} catch {
  [ordered]@{ success = $false; logs = @($logs); error = $_.Exception.Message } |
    ConvertTo-Json -Depth 8 | Set-Content -LiteralPath '${resultLiteral}' -Encoding UTF8
  exit 1
}
`;
  await writeFile(scriptPath, `\uFEFF${wrapped}`, "utf8");

  const scriptLiteral = escapePowerShellSingleQuoted(scriptPath);
  const launcher = `
$scriptPath = '${scriptLiteral}'
$arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $scriptPath + '"'
$process = Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $arguments -Wait -PassThru
exit $process.ExitCode
`;

  try {
    await runPowerShell(launcher, timeoutMs);
  } catch (error) {
    try {
      await access(resultPath);
    } catch {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`管理员授权被取消或操作未能启动：${detail}`);
    }
  }

  const parsed = JSON.parse((await readFile(resultPath, "utf8")).replace(/^\uFEFF/, "")) as ElevatedResult;
  if (!parsed.success) throw new Error(parsed.error || "管理员操作失败");
  return parsed;
};

export const isRunningAsAdministrator = async (): Promise<boolean> => {
  try {
    return (
      (await runPowerShell(
        `[Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent() |
          ForEach-Object { $_.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator) }`,
      )) === "True"
    );
  } catch {
    return false;
  }
};

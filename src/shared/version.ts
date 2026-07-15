const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

interface ParsedVersion {
  numbers: [number, number, number];
  prerelease?: string;
}

export const normalizeVersion = (value: string): string => value.trim().replace(/^v/i, "");

const parseVersion = (value: string): ParsedVersion | undefined => {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return undefined;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return undefined;
  return {
    numbers: [major, minor, patch],
    prerelease: match[4],
  };
};

export const compareVersions = (left: string, right: string): number => {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error("版本号格式无效");

  for (let index = 0; index < a.numbers.length; index += 1) {
    const difference = a.numbers[index]! - b.numbers[index]!;
    if (difference !== 0) return Math.sign(difference);
  }

  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
};

export const isNewerVersion = (latest: string, current: string): boolean =>
  compareVersions(latest, current) > 0;

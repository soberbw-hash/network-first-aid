export const isAllowedReleaseUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "github.com" &&
      url.pathname.startsWith("/soberbw-hash/network-first-aid/releases/")
    );
  } catch {
    return false;
  }
};

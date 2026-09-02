const CHANNEL_ID = "museve_voice";
const DEFAULT_ACCOUNT_ID = "default";

export type MuseveAccountConfig = Record<string, unknown>;

export const REQUIRED_MUSEVE_BINDING_FIELDS = [
  "token",
  "instanceId",
  "boundAt",
  "boundUserId",
  "serverUrl",
  "apiBaseUrl",
] as const;

function objectValue(value: unknown): MuseveAccountConfig {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as MuseveAccountConfig)
    : {};
}

function resolveChannelAccountsRoot(cfg: any): MuseveAccountConfig {
  return objectValue(cfg?.channelAccounts?.[CHANNEL_ID]);
}

function resolveChannelAccount(cfg: any, accountId = DEFAULT_ACCOUNT_ID): MuseveAccountConfig {
  const root = resolveChannelAccountsRoot(cfg);
  const nested = objectValue(root[accountId]);
  return Object.keys(nested).length > 0 ? nested : root;
}

function looksLikeMuseveAccount(config: MuseveAccountConfig): boolean {
  return ["enabled", ...REQUIRED_MUSEVE_BINDING_FIELDS].some((key) => key in config);
}

export function ensureMuseveChannel(cfg: any): MuseveAccountConfig {
  cfg.channels ??= {};
  cfg.channels[CHANNEL_ID] ??= {};
  return cfg.channels[CHANNEL_ID];
}

export function ensureMuseveChannelAccount(cfg: any, accountId = DEFAULT_ACCOUNT_ID): MuseveAccountConfig {
  cfg.channelAccounts ??= {};
  cfg.channelAccounts[CHANNEL_ID] ??= {};
  const root = cfg.channelAccounts[CHANNEL_ID];

  if (root && typeof root === "object" && !Array.isArray(root)) {
    const record = root as MuseveAccountConfig;
    if (record[accountId] && typeof record[accountId] === "object" && !Array.isArray(record[accountId])) {
      return record[accountId] as MuseveAccountConfig;
    }
    return record;
  }

  cfg.channelAccounts[CHANNEL_ID] = {};
  return cfg.channelAccounts[CHANNEL_ID];
}

export function resolveMuseveAccount(cfg: any, accountId = DEFAULT_ACCOUNT_ID): MuseveAccountConfig {
  const direct = objectValue(cfg);
  return {
    accountId,
    ...(looksLikeMuseveAccount(direct) ? direct : {}),
    ...objectValue(cfg?.channels?.[CHANNEL_ID]),
    ...resolveChannelAccount(cfg, accountId),
  };
}

export function setMuseveAccount(cfg: any, patch: MuseveAccountConfig, accountId = DEFAULT_ACCOUNT_ID): any {
  const channel = ensureMuseveChannel(cfg);
  Object.assign(channel, patch);
  if (patch._pendingCode === "") delete channel._pendingCode;
  return cfg;
}

export function readNonEmptyString(config: MuseveAccountConfig, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

export function missingMuseveBindingFields(config: MuseveAccountConfig): string[] {
  const missing: string[] = REQUIRED_MUSEVE_BINDING_FIELDS.filter(
    (field) => !readNonEmptyString(config, field),
  );
  if (config.enabled !== true) missing.unshift("enabled");
  return missing;
}

export function hasCompleteMuseveBinding(config: MuseveAccountConfig): boolean {
  return missingMuseveBindingFields(config).length === 0;
}

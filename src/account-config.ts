const CHANNEL_ID = "xalgo_voice";
const DEFAULT_ACCOUNT_ID = "default";

export type XalgoAccountConfig = Record<string, unknown>;

export const REQUIRED_XALGO_BINDING_FIELDS = [
  "token",
  "instanceId",
  "boundAt",
  "boundUserId",
  "serverUrl",
  "apiBaseUrl",
] as const;

function objectValue(value: unknown): XalgoAccountConfig {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as XalgoAccountConfig)
    : {};
}

function resolveChannelAccountsRoot(cfg: any): XalgoAccountConfig {
  return objectValue(cfg?.channelAccounts?.[CHANNEL_ID]);
}

function resolveChannelAccount(cfg: any, accountId = DEFAULT_ACCOUNT_ID): XalgoAccountConfig {
  const root = resolveChannelAccountsRoot(cfg);
  const nested = objectValue(root[accountId]);
  return Object.keys(nested).length > 0 ? nested : root;
}

function looksLikeXalgoAccount(config: XalgoAccountConfig): boolean {
  return ["enabled", ...REQUIRED_XALGO_BINDING_FIELDS].some((key) => key in config);
}

export function ensureXalgoChannel(cfg: any): XalgoAccountConfig {
  cfg.channels ??= {};
  cfg.channels[CHANNEL_ID] ??= {};
  return cfg.channels[CHANNEL_ID];
}

export function ensureXalgoChannelAccount(cfg: any, accountId = DEFAULT_ACCOUNT_ID): XalgoAccountConfig {
  cfg.channelAccounts ??= {};
  cfg.channelAccounts[CHANNEL_ID] ??= {};
  const root = cfg.channelAccounts[CHANNEL_ID];

  if (root && typeof root === "object" && !Array.isArray(root)) {
    const record = root as XalgoAccountConfig;
    if (record[accountId] && typeof record[accountId] === "object" && !Array.isArray(record[accountId])) {
      return record[accountId] as XalgoAccountConfig;
    }
    return record;
  }

  cfg.channelAccounts[CHANNEL_ID] = {};
  return cfg.channelAccounts[CHANNEL_ID];
}

export function resolveXalgoAccount(cfg: any, accountId = DEFAULT_ACCOUNT_ID): XalgoAccountConfig {
  const direct = objectValue(cfg);
  return {
    accountId,
    ...(looksLikeXalgoAccount(direct) ? direct : {}),
    ...objectValue(cfg?.channels?.[CHANNEL_ID]),
    ...resolveChannelAccount(cfg, accountId),
  };
}

export function setXalgoAccount(cfg: any, patch: XalgoAccountConfig, accountId = DEFAULT_ACCOUNT_ID): any {
  const channel = ensureXalgoChannel(cfg);
  const account = ensureXalgoChannelAccount(cfg, accountId);
  Object.assign(channel, patch);
  Object.assign(account, patch, { accountId });
  return cfg;
}

export function readNonEmptyString(config: XalgoAccountConfig, key: string): string {
  const value = config[key];
  return typeof value === "string" ? value.trim() : "";
}

export function missingXalgoBindingFields(config: XalgoAccountConfig): string[] {
  const missing: string[] = REQUIRED_XALGO_BINDING_FIELDS.filter(
    (field) => !readNonEmptyString(config, field),
  );
  if (config.enabled !== true) missing.unshift("enabled");
  return missing;
}

export function hasCompleteXalgoBinding(config: XalgoAccountConfig): boolean {
  return missingXalgoBindingFields(config).length === 0;
}

export interface RiskPolicy {
  confirmExternalSend: boolean;
  confirmDangerousTools: boolean;
  allowPureVoiceR3: boolean;
}

export interface ReconnectConfig {
  minDelayMs: number;
  maxDelayMs: number;
  resume: boolean;
}

export interface XalgoVoiceConfig {
  enabled: boolean;
  serverUrl: string;
  token: string;
  agentId: string;
  sessionPrefix: string;
  streaming: boolean;
  replyMode: "voice_first" | "text_first" | "both";
  riskPolicy: RiskPolicy;
  reconnect: ReconnectConfig;
}

export const DEFAULT_CONFIG: Omit<XalgoVoiceConfig, "token"> = {
  enabled: false,
  serverUrl: "wss://channel.xalgo.ai/openclaw/connect",
  agentId: "voice",
  sessionPrefix: "xalgo_voice",
  streaming: true,
  replyMode: "voice_first",
  riskPolicy: {
    confirmExternalSend: true,
    confirmDangerousTools: true,
    allowPureVoiceR3: false,
  },
  reconnect: {
    minDelayMs: 1000,
    maxDelayMs: 30000,
    resume: true,
  },
};

export function resolveConfig(raw: Partial<XalgoVoiceConfig> & { token: string }): XalgoVoiceConfig {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    riskPolicy: { ...DEFAULT_CONFIG.riskPolicy, ...raw.riskPolicy },
    reconnect: { ...DEFAULT_CONFIG.reconnect, ...raw.reconnect },
  };
}

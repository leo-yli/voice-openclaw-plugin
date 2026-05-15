import { createLogger } from "./logger.js";

const log = createLogger("binding-store");

export interface BindingState {
  token: string;
  instanceId: string;
  boundAt: string;
  boundUserId: string;
  boundUserName?: string;
  deviceLabel?: string;
}

export interface BindingStore {
  read(): Promise<BindingState | null>;
  write(state: BindingState): Promise<void>;
  updateToken(newToken: string): Promise<void>;
  clear(): Promise<void>;
  isBound(): Promise<boolean>;
}

export interface StoreAdapter {
  read: (key: string) => Promise<unknown>;
  write: (key: string, value: unknown) => Promise<void>;
}

const KEYS = {
  token: "channels.xalgoVoice.token",
  instanceId: "channels.xalgoVoice.instanceId",
  boundAt: "channels.xalgoVoice.boundAt",
  boundUserId: "channels.xalgoVoice.boundUserId",
  boundUserName: "channels.xalgoVoice.boundUserName",
  deviceLabel: "channels.xalgoVoice.deviceLabel",
} as const;

export function createBindingStore(adapter: StoreAdapter): BindingStore {
  const readField = async (key: string): Promise<string> => {
    const v = await adapter.read(key);
    return typeof v === "string" ? v : "";
  };

  return {
    async read(): Promise<BindingState | null> {
      const token = await readField(KEYS.token);
      const instanceId = await readField(KEYS.instanceId);
      const boundAt = await readField(KEYS.boundAt);
      const boundUserId = await readField(KEYS.boundUserId);

      // 任意一个必需字段缺失 = 未绑定
      if (!token || !instanceId || !boundAt || !boundUserId) {
        return null;
      }

      const boundUserName = await readField(KEYS.boundUserName);
      const deviceLabel = await readField(KEYS.deviceLabel);
      return {
        token,
        instanceId,
        boundAt,
        boundUserId,
        ...(boundUserName ? { boundUserName } : {}),
        ...(deviceLabel ? { deviceLabel } : {}),
      };
    },

    async write(state: BindingState): Promise<void> {
      await adapter.write(KEYS.token, state.token);
      await adapter.write(KEYS.instanceId, state.instanceId);
      await adapter.write(KEYS.boundAt, state.boundAt);
      await adapter.write(KEYS.boundUserId, state.boundUserId);
      await adapter.write(KEYS.boundUserName, state.boundUserName ?? "");
      await adapter.write(KEYS.deviceLabel, state.deviceLabel ?? "");
      log.info(`Binding written for user=${state.boundUserId} instance=${state.instanceId.slice(0, 16)}...`);
    },

    async updateToken(newToken: string): Promise<void> {
      const current = await this.read();
      if (!current) throw new Error("No binding exists, cannot updateToken");
      await adapter.write(KEYS.token, newToken);
      log.info(`Token rotated for instance=${current.instanceId.slice(0, 16)}...`);
    },

    async clear(): Promise<void> {
      await adapter.write(KEYS.token, "");
      await adapter.write(KEYS.instanceId, "");
      await adapter.write(KEYS.boundAt, "");
      await adapter.write(KEYS.boundUserId, "");
      await adapter.write(KEYS.boundUserName, "");
      await adapter.write(KEYS.deviceLabel, "");
      log.info("Binding cleared");
    },

    async isBound(): Promise<boolean> {
      return (await this.read()) !== null;
    },
  };
}

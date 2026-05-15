declare module "openclaw" {
  export interface OpenClawApi {
    registerChannel(opts: { plugin: ChannelPlugin }): void;
  }

  export interface ChannelPlugin {
    id: string;
    meta: {
      id: string;
      label: string;
      selectionLabel?: string;
      docsPath?: string;
      blurb?: string;
    };
    capabilities: Record<string, unknown>;
    config: {
      listAccountIds: (cfg: any) => string[];
      resolveAccount: (cfg: any, accountId?: string) => any;
    };
    outbound: any;
    inbound: any;
  }

  /** OpenClaw setup wizard 上下文（spec §13） */
  export interface SetupContext {
    prompt: (question: string) => Promise<string>;
    writeConfig: (key: string, value: unknown) => Promise<void>;
    log: (msg: string) => void;
    /** 可选：读现有配置。OpenClaw 框架是否提供为 spec §14 开放问题 */
    readConfig?: (key: string) => Promise<unknown>;
  }
}

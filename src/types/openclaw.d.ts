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
}

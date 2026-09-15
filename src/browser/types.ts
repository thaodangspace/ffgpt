export interface BrowserContextInfo {
  id: string;
  url: string;
  title?: string;
}

export interface BrowserDriver {
  connect(): Promise<void>;
  listContexts(): Promise<BrowserContextInfo[]>;
  createContext(): Promise<string>;
  navigate(contextId: string, url: string): Promise<void>;
  evaluate<T>(
    contextId: string,
    functionDeclaration: string,
    args?: readonly unknown[],
  ): Promise<T>;
  disconnect(): Promise<void>;
}

import * as vscode from "vscode";

/** Tokens live in SecretStorage (the OS keychain), never in settings. */
export class Secrets {
  constructor(private readonly store: vscode.SecretStorage) {}

  get(key: string): Thenable<string | undefined> {
    return this.store.get(key);
  }

  async prompt(key: string, label: string): Promise<boolean> {
    const value = await vscode.window.showInputBox({ prompt: label, password: true, ignoreFocusOut: true });
    if (!value) { return false; }
    await this.store.store(key, value.trim());
    return true;
  }
}

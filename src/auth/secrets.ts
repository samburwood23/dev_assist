import * as vscode from "vscode";

/** Tokens live in SecretStorage (the OS keychain), never in settings. */
export class Secrets {
  constructor(private readonly store: vscode.SecretStorage) {}

  /** Fires with the key whenever a secret is stored or deleted (including from another window). */
  get onDidChange(): vscode.Event<vscode.SecretStorageChangeEvent> {
    return this.store.onDidChange;
  }

  get(key: string): Thenable<string | undefined> {
    return this.store.get(key);
  }

  async has(key: string): Promise<boolean> {
    return !!(await this.store.get(key));
  }

  set(key: string, value: string): Thenable<void> {
    return this.store.store(key, value.trim());
  }

  delete(key: string): Thenable<void> {
    return this.store.delete(key);
  }

  async prompt(key: string, label: string): Promise<boolean> {
    const value = await vscode.window.showInputBox({ prompt: label, password: true, ignoreFocusOut: true });
    if (!value) { return false; }
    await this.set(key, value);
    return true;
  }
}

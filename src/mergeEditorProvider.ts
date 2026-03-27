import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { parseXlf } from './xlfParser';

export class MergeEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'bcXlf.mergeEditor';

  constructor(private readonly context: vscode.ExtensionContext) {}

  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')
      ]
    };

    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'mergeEditor.js')
    );

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, scriptUri);

    const sendUnits = async (): Promise<void> => {
      webviewPanel.webview.postMessage({
        type: 'loading',
        message: 'Parsing XLF…'
      });
      const text = document.getText();
      const doc = await parseXlf(text, (n) => {
        if (n % 2000 === 0) {
          webviewPanel.webview.postMessage({
            type: 'loading',
            message: `Parsing… ${n} units`
          });
        }
      });

      const rows: Array<{
        id: string;
        source: string;
        target: string;
        targetState: string;
      }> = [];
      for (const id of doc.orderedIds) {
        const u = doc.units.get(id);
        if (!u) {
          continue;
        }
        rows.push({
          id: u.id,
          source: u.source,
          target: u.target,
          targetState: u.targetState
        });
      }

      webviewPanel.webview.postMessage({ type: 'units', units: rows });
    };

    webviewPanel.webview.onDidReceiveMessage((msg) => {
      if (msg?.type === 'ready') {
        void sendUnits();
      }
    });

    const sub = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString()) {
        void sendUnits();
      }
    });
    webviewPanel.onDidDispose(() => sub.dispose());
  }

  private getHtml(webview: vscode.Webview, scriptUri: vscode.Uri): string {
    const htmlPath = path.join(this.context.extensionPath, 'webview', 'mergeEditor.html');
    const raw = fs.readFileSync(htmlPath, 'utf8');
    const csp = [
      "default-src 'none'",
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src ${webview.cspSource}`
    ].join('; ');
    return raw.replace('{{CSP}}', csp).replace('{{SCRIPT_URI}}', scriptUri.toString());
  }
}

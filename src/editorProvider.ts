import * as vscode from 'vscode';

/**
 * Provider for the Custom Gitignore Editor.
 */
export class GitignoreEditorProvider implements vscode.CustomTextEditorProvider {

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        const provider = new GitignoreEditorProvider(context);
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            GitignoreEditorProvider.viewType,
            provider
        );
        return providerRegistration;
    }

    private static readonly viewType = 'gitignore-helper.editor';

    constructor(
        private readonly context: vscode.ExtensionContext
    ) { }

    /**
     * Called when our custom editor is opened.
     */
    public async resolveCustomTextEditor(
        document: vscode.TextDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        // Setup initial content for the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        webviewPanel.webview.html = this.getHtmlForWebview(webviewPanel.webview);

        function updateWebview() {
            webviewPanel.webview.postMessage({
                type: 'update',
                text: document.getText(),
            });
        }

        // Hook up event handlers so that we can synchronize the webview with the text document.
        //
        // The text document acts as our model. The webview is the view.
        //
        // 1. Update webview when the document changes
        const changeDocumentSubscription = vscode.workspace.onDidChangeTextDocument(e => {
            if (e.document.uri.toString() === document.uri.toString()) {
                updateWebview();
            }
        });

        // 2. Make sure we get rid of the listener when our editor is closed.
        webviewPanel.onDidDispose(() => {
            changeDocumentSubscription.dispose();
        });

        // Receive message from the webview.
        webviewPanel.webview.onDidReceiveMessage(e => {
            switch (e.type) {
                case 'change':
                    this.updateTextDocument(document, e.text);
                    return;
                case 'generate':
                    vscode.commands.executeCommand('extension.generateGitignore');
                    return;
                case 'cleanup':
                    vscode.commands.executeCommand('extension.cleanupGitignore');
                    return;
            }
        });

        updateWebview();
    }

    /**
     * Get the static HTML used for the editor webviews.
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Gitignore Editor</title>
                <style>
                    body {
                        background-color: var(--vscode-editor-background);
                        color: var(--vscode-editor-foreground);
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                        padding: 0;
                        margin: 0;
                        display: flex;
                        flex-direction: column;
                        height: 100vh;
                    }
                    .text-area-container {
                        flex: 1;
                        display: flex;
                        position: relative;
                    }
                    textarea {
                        flex: 1;
                        width: 100%;
                        height: 100%;
                        background-color: transparent;
                        color: inherit;
                        border: none;
                        padding: 10px; /* Standard editor padding */
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                        line-height: 1.5;
                        resize: none;
                        outline: none;
                        white-space: pre;
                        box-sizing: border-box;
                    }
                    /* Scrollbar styling to match VS Code */
                    ::-webkit-scrollbar {
                        width: 10px;
                        height: 10px;
                    }
                    ::-webkit-scrollbar-thumb {
                        background: var(--vscode-scrollbarSlider-background);
                    }
                    ::-webkit-scrollbar-thumb:hover {
                        background: var(--vscode-scrollbarSlider-hoverBackground);
                    }
                    ::-webkit-scrollbar-thumb:active {
                        background: var(--vscode-scrollbarSlider-activeBackground);
                    }

                    .button-container {
                        position: fixed;
                        bottom: 40px;
                        right: 40px;
                        display: flex;
                        flex-direction: column;
                        gap: 10px;
                        z-index: 1000;
                    }
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        padding: 6px 14px; /* Native button padding */
                        border-radius: 2px; /* Native button radius */
                        font-family: var(--vscode-font-family);
                        font-size: 13px; /* Standard button text size */
                        font-weight: 400;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        outline-offset: 2px;
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    /* Add a subtle shadow to make them float nicely on top of text */
                    button {
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                    }
                </style>
            </head>
            <body>
                <div class="text-area-container">
                    <textarea id="editor" spellcheck="false"></textarea>
                </div>

                <div class="button-container">
                    <button onclick="cleanup()">Clean & Sort</button>
                    <button onclick="generate()">Generate gitignore</button>
                </div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const editor = document.getElementById('editor');
                    
                    // Handle messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                const text = message.text;
                                if (text !== editor.value) {
                                    editor.value = text;
                                }
                                break;
                        }
                    });

                    // Send changes to extension
                    editor.addEventListener('input', () => {
                         vscode.postMessage({
                            type: 'change',
                            text: editor.value
                         });
                    });

                    function cleanup() {
                        vscode.postMessage({ type: 'cleanup' });
                    }

                    function generate() {
                        vscode.postMessage({ type: 'generate' });
                    }
                </script>
            </body>
            </html>`;
    }

    /**
     * Write new text to the document.
     */
    private updateTextDocument(document: vscode.TextDocument, text: string) {
        const edit = new vscode.WorkspaceEdit();

        // Just replace the entire document every time for simplicity in this V1.
        // For production, we should compute diffs. But for .gitignore it's fine.
        edit.replace(
            document.uri,
            new vscode.Range(0, 0, document.lineCount, 0),
            text
        );

        return vscode.workspace.applyEdit(edit);
    }
}

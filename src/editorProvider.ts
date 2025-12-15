import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

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
        webviewPanel.webview.onDidReceiveMessage(async e => {
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
                case 'autocomplete':
                    const items = await this.provideCompletionItems(document, e.text);
                    webviewPanel.webview.postMessage({
                        type: 'autocomplete-response',
                        items: items,
                        requestId: e.requestId
                    });
                    return;
            }
        });

        updateWebview();
    }

    private async provideCompletionItems(document: vscode.TextDocument, lineText: string): Promise<any[]> {
         // Trim whitespace from start
         let cleanLine = lineText.trimStart();
        
         // Handle negation
         if (cleanLine.startsWith('!')) {
             cleanLine = cleanLine.substring(1);
         }
         // Handle root anchor
         if (cleanLine.startsWith('/')) {
             cleanLine = cleanLine.substring(1);
         }
 
         const gitignoreDir = path.dirname(document.uri.fsPath);
         let searchDir = gitignoreDir;
         let prefix = cleanLine;
 
         if (cleanLine.includes('/')) {
             const parts = cleanLine.split('/');
             const dirPart = parts.slice(0, -1).join(path.sep);
             prefix = parts[parts.length - 1];
             searchDir = path.join(gitignoreDir, dirPart);
         }
 
         if (!fs.existsSync(searchDir)) {
             return [];
         }
 
         try {
             const stats = await fs.promises.stat(searchDir);
             if (!stats.isDirectory()) return [];
 
             const files = await fs.promises.readdir(searchDir, { withFileTypes: true });
             const items: any[] = [];
 
             for (const file of files) {
                 if (file.name === '.git' || file.name === '.gitignore') continue;
                 
                 // Simple fuzzy match on prefix
                 if (prefix && !file.name.toLowerCase().startsWith(prefix.toLowerCase())) {
                     continue;
                 }
 
                 const isDir = file.isDirectory();
                 items.push({
                     label: file.name,
                     type: isDir ? 'folder' : 'file',
                     insertText: isDir ? file.name + '/' : file.name
                 });
             }
             
             // Sort folders first
             items.sort((a, b) => {
                 if (a.type === b.type) return a.label.localeCompare(b.label);
                 return a.type === 'folder' ? -1 : 1;
             });
 
             return items;
 
         } catch (error) {
             console.error('Error in GitignoreEditorProvider autocomplete:', error);
             return [];
         }
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
                        overflow: hidden;
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
                        padding: 10px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                        line-height: 1.5;
                        resize: none;
                        outline: none;
                        white-space: pre;
                        box-sizing: border-box;
                    }
                    /* Scrollbar styling */
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
                        padding: 6px 14px;
                        border-radius: 2px;
                        font-family: var(--vscode-font-family);
                        font-size: 13px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
                    }
                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    /* Autocomplete Styles */
                    #suggestion-box {
                        position: absolute;
                        background-color: var(--vscode-editorWidget-background);
                        border: 1px solid var(--vscode-editorWidget-border);
                        box-shadow: 0 4px 6px rgba(0,0,0,0.3);
                        z-index: 2000;
                        max-height: 200px;
                        overflow-y: auto;
                        display: none;
                        width: 250px;
                        font-family: var(--vscode-editor-font-family);
                        font-size: var(--vscode-editor-font-size);
                    }
                    .suggestion-item {
                        padding: 4px 8px;
                        cursor: pointer;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                    }
                    .suggestion-item:hover, .suggestion-item.selected {
                        background-color: var(--vscode-list-activeSelectionBackground);
                        color: var(--vscode-list-activeSelectionForeground);
                    }
                    .icon {
                        width: 14px;
                        height: 14px;
                        display: inline-block;
                        flex-shrink: 0;
                    }
                    
                    /* Loader Styles */
                    #loader {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background-color: var(--vscode-editor-background);
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        z-index: 3000;
                    }
                    .spinner {
                        border: 3px solid var(--vscode-widget-border);
                        border-top: 3px solid var(--vscode-progressBar-background);
                        border-radius: 50%;
                        width: 30px;
                        height: 30px;
                        animation: spin 1s linear infinite;
                    }
                    @keyframes spin {
                        0% { transform: rotate(0deg); }
                        100% { transform: rotate(360deg); }
                    }

                </style>
            </head>
            <body>
                 <div id="loader">
                    <div class="spinner"></div>
                </div>

                <div class="text-area-container">
                    <textarea id="editor" spellcheck="false"></textarea>
                    <div id="suggestion-box"></div>
                </div>

                <div class="button-container">
                    <button onclick="cleanup()">Clean & Sort</button>
                    <button onclick="generate()">Generate gitignore</button>
                </div>

                <!-- Mirror div for caret coordinates calculation -->
                <div id="mirror-div" style="position: absolute; top:0; left:0; visibility: hidden; white-space: pre; pointer-events: none; overflow: hidden;"></div>

                <script>
                    const vscode = acquireVsCodeApi();
                    const editor = document.getElementById('editor');
                    const suggestionBox = document.getElementById('suggestion-box');
                    const mirrorDiv = document.getElementById('mirror-div');
                    const loader = document.getElementById('loader');
                    
                    let currentRequestId = 0;
                    let selectedIndex = -1;
                    let currentItems = [];

                    // ------------------
                    // Core Message Handling
                    // ------------------
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.type) {
                            case 'update':
                                // Hide loader on first update
                                if (loader.style.display !== 'none') {
                                    loader.style.display = 'none';
                                }
                                const text = message.text;
                                if (text !== editor.value) {
                                    editor.value = text;
                                }
                                break;
                            case 'autocomplete-response':
                                if (message.requestId === currentRequestId) {
                                    showSuggestions(message.items);
                                }
                                break;
                        }
                    });

                    editor.addEventListener('input', (e) => {
                         vscode.postMessage({
                            type: 'change',
                            text: editor.value
                         });

                         // Debounce autocomplete? For local fs it's fast, let's try direct first.
                         const cursorPosition = editor.selectionEnd;
                         const textBeforeCursor = editor.value.substring(0, cursorPosition);
                         const lines = textBeforeCursor.split('\\n');
                         const currentLine = lines[lines.length - 1];

                         // Trigger logic: 
                         // 1. Don't show if empty or whitespace only
                         if (!currentLine.trim()) {
                             hideSuggestions();
                             return;
                         }

                         // We request autocomplete for the current line text
                         currentRequestId++;
                         vscode.postMessage({
                             type: 'autocomplete',
                             text: currentLine,
                             requestId: currentRequestId
                         });
                    });

                    // ------------------
                    // Caret Coordinates Logic (Mirror Div)
                    // ------------------
                    function getCaretCoordinates() {
                        const style = window.getComputedStyle(editor);
                        
                        const cursorPosition = editor.selectionEnd;
                        const text = editor.value.substring(0, cursorPosition);
                        const lines = text.split('\\n');
                        
                        // Measure line height accurately
                        let lineHeight = parseFloat(style.lineHeight);
                        if (isNaN(lineHeight)) {
                            const tempSpan = document.createElement('span');
                            tempSpan.textContent = "Hg";
                            tempSpan.style.fontFamily = style.fontFamily;
                            tempSpan.style.fontSize = style.fontSize;
                            tempSpan.style.padding = "0";
                            tempSpan.style.visibility = 'hidden';
                            tempSpan.style.position = 'absolute';
                            document.body.appendChild(tempSpan);
                            lineHeight = tempSpan.getBoundingClientRect().height;
                            document.body.removeChild(tempSpan);
                        }

                        const lineIndex = lines.length - 1;
                        const lastLineText = lines[lineIndex];

                        // Measure width of text before cursor in the current line
                        const span = document.createElement('span');
                        span.textContent = lastLineText;
                        span.style.visibility = 'hidden';
                        span.style.position = 'absolute';
                        span.style.fontFamily = style.fontFamily;
                        span.style.fontSize = style.fontSize;
                        // Important: match spacing/tabs if possible, but for now we assume simple text
                        document.body.appendChild(span);
                        const width = span.getBoundingClientRect().width;
                        document.body.removeChild(span);

                        // 10px padding from textarea style
                        const padding = 10;
                        const top = (lineIndex * lineHeight) + padding; 
                        const left = width + padding; 

                        return {
                            top: top - editor.scrollTop,
                            left: left - editor.scrollLeft
                        };
                    }

                    // ------------------
                    // Suggestion UI
                    // ------------------
                    function showSuggestions(items) {
                        // Filter out exact matches for files
                        // We need to know the current prefix to compare
                        const cursorPosition = editor.selectionEnd;
                        const textBeforeCursor = editor.value.substring(0, cursorPosition);
                        const lines = textBeforeCursor.split('\\n');
                        const currentLine = lines[lines.length - 1];
                        const lastSlashIndex = currentLine.lastIndexOf('/');
                        const prefix = lastSlashIndex !== -1 ? currentLine.substring(lastSlashIndex + 1) : currentLine;

                        const filteredItems = items.filter(item => {
                            if (item.type === 'file' && item.label === prefix) {
                                return false;
                            }
                            return true;
                        });

                        if (!filteredItems || filteredItems.length === 0) {
                            hideSuggestions();
                            return;
                        }

                        currentItems = filteredItems;
                        selectedIndex = 0;
                        suggestionBox.innerHTML = '';
                        
                        currentItems.forEach((item, index) => {
                            const div = document.createElement('div');
                            div.className = 'suggestion-item';
                            if (index === 0) div.classList.add('selected');
                            
                            // Icons
                            const iconSvg = item.type === 'folder' 
                                ? '<svg class="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M7.17 2a1 1 0 0 1 .7.29L9.5 4h5a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-13a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h5.67zM8 3H1.5v9h13V5H9L7.5 3z"/></svg>' // Folder Icon
                                : '<svg class="icon" viewBox="0 0 16 16" fill="currentColor"><path d="M2 1a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V4l-3-3H2zm12 3.5V14H3V2h8.5v2.5H14zM8 10a1 1 0 1 1 0-2 1 1 0 0 1 0 2z"/></svg>'; // File Icon

                            div.innerHTML = \`\${iconSvg}<span>\${item.label}</span>\`;
                            
                            div.onclick = () => selectItem(index);
                            suggestionBox.appendChild(div);
                        });

                        const coords = getCaretCoordinates();
                        // Adjust if close to bottom edge? 
                        const top = coords.top + 20; // push down a bit
                        suggestionBox.style.top = top + 'px';
                        suggestionBox.style.left = coords.left + 'px';
                        suggestionBox.style.display = 'block';
                    }

                    function hideSuggestions() {
                        suggestionBox.style.display = 'none';
                        currentItems = [];
                        selectedIndex = -1;
                    }

                    function selectItem(index) {
                        if (index < 0 || index >= currentItems.length) return;
                        const item = currentItems[index];
                        
                        // Insert text
                        const cursorPosition = editor.selectionEnd;
                        const text = editor.value;
                        const textBeforeCursor = text.substring(0, cursorPosition);
                        const lines = textBeforeCursor.split('\\n');
                        const currentLine = lines[lines.length - 1];
                        
                        let insertPos = cursorPosition;
                        let replaceLength = 0;
                        
                        const lastSlashIndex = currentLine.lastIndexOf('/');
                        if (lastSlashIndex !== -1) {
                            // We are typing after a slash
                             const dirPart = currentLine.substring(0, lastSlashIndex + 1);
                             const newLine = dirPart + item.insertText;
                             
                             // Replace the current line in the editor
                             const lineStartPos = textBeforeCursor.lastIndexOf('\\n') + 1;
                             const newText = text.substring(0, lineStartPos) + newLine + text.substring(cursorPosition);
                             editor.value = newText;
                             
                             // Move cursor
                             editor.selectionEnd = lineStartPos + newLine.length;
                        } else {
                            // No slash, replacing the word being typed
                             const lineStartPos = textBeforeCursor.lastIndexOf('\\n') + 1;
                             const newText = text.substring(0, lineStartPos) + item.insertText + text.substring(cursorPosition);
                             editor.value = newText;
                             editor.selectionEnd = lineStartPos + item.insertText.length;
                        }

                        hideSuggestions();
                        editor.focus();
                        
                        // Update model
                        vscode.postMessage({
                            type: 'change',
                            text: editor.value
                        });

                        // Only re-trigger if it is a folder
                        if (item.type === 'folder') {
                            const newCursorPosition = editor.selectionEnd;
                            const newTextBeforeCursor = editor.value.substring(0, newCursorPosition);
                            const newLines = newTextBeforeCursor.split('\\n');
                            const newCurrentLine = newLines[newLines.length - 1];

                            currentRequestId++;
                            vscode.postMessage({
                                type: 'autocomplete',
                                text: newCurrentLine,
                                requestId: currentRequestId
                            });
                        }
                    }

                    // Keyboard navigation
                    editor.addEventListener('keydown', (e) => {
                        if (currentItems.length > 0 && suggestionBox.style.display !== 'none') {
                            if (e.key === 'ArrowDown') {
                                e.preventDefault();
                                selectedIndex = (selectedIndex + 1) % currentItems.length;
                                updateSelection();
                            } else if (e.key === 'ArrowUp') {
                                e.preventDefault();
                                selectedIndex = (selectedIndex - 1 + currentItems.length) % currentItems.length;
                                updateSelection();
                            } else if (e.key === 'Enter' || e.key === 'Tab') {
                                e.preventDefault();
                                selectItem(selectedIndex);
                            } else if (e.key === 'Escape') {
                                hideSuggestions();
                            }
                        }
                    });

                    function updateSelection() {
                        const items = suggestionBox.querySelectorAll('.suggestion-item');
                        items.forEach((item, index) => {
                            if (index === selectedIndex) {
                                item.classList.add('selected');
                                item.scrollIntoView({ block: 'nearest' });
                            } else {
                                item.classList.remove('selected');
                            }
                        });
                    }

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

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export class GitignoreCompletionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(document: vscode.TextDocument, position: vscode.Position, token: vscode.CancellationToken, context: vscode.CompletionContext): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const config = vscode.workspace.getConfiguration('addToGitignore');
        if (!config.get('enableAutocomplete')) {
            return [];
        }

        const line = document.lineAt(position);
        let lineText = line.text.substring(0, position.character);
        
        // Trim whitespace from start
        lineText = lineText.trimStart();
        
        // Handle negation
        if (lineText.startsWith('!')) {
            lineText = lineText.substring(1);
        }
        // Handle root anchor or nested path
        if (lineText.startsWith('/')) {
            lineText = lineText.substring(1);
        }

        // The directory where .gitignore resides
        const gitignoreDir = path.dirname(document.uri.fsPath);

        let searchDir = gitignoreDir;
        let prefix = lineText;

        // If user typed 'src/', we want to search in 'src' folder
        // If user typed 'src/co', we want to search in 'src' folder with prefix 'co'
        
        if (lineText.includes('/')) {
            const parts = lineText.split('/');
            // Everything up to the last slash is the directory path
            const dirPart = parts.slice(0, -1).join(path.sep);
            // The last part is the prefix to filter by (VS Code handles some fuzzy matching, but we need the right folder)
            prefix = parts[parts.length - 1];
            
            searchDir = path.join(gitignoreDir, dirPart);
        }

        if (!fs.existsSync(searchDir)) {
            return [];
        }

        try {
            const stats = fs.statSync(searchDir);
            if (!stats.isDirectory()) return [];

            const files = fs.readdirSync(searchDir, { withFileTypes: true });
            const items: vscode.CompletionItem[] = [];

            for (const file of files) {
                if (file.name === '.git' || file.name === '.gitignore') continue;
                
                const kind = file.isDirectory() ? vscode.CompletionItemKind.Folder : vscode.CompletionItemKind.File;
                const item = new vscode.CompletionItem(file.name, kind);
                
                if (file.isDirectory()) {
                    item.label = file.name + '/';
                    item.insertText = file.name + '/'; 
                    item.command = { command: 'editor.action.triggerSuggest', title: 'Re-trigger suggestions' };
                    // Set sort text to ensure folders come first? Or close to files? 
                    // Usually folders first is good.
                    item.sortText = '0' + file.name; 
                } else {
                    item.sortText = '1' + file.name;
                }
                
                items.push(item);
            }
            return items;

        } catch (error) {
            console.error('Error in GitignoreCompletionProvider:', error);
            return [];
        }
    }
}

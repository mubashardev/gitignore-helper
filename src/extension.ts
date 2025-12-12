import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as cp from 'child_process';
import * as util from 'util';
import { GitignoreCompletionProvider } from './completionProvider';

const exec = util.promisify(cp.exec);

export function activate(context: vscode.ExtensionContext) {
    const addToGitignoreCommand = vscode.commands.registerCommand('extension.addToGitignore', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No file selected.');
            return;
        }

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('File is not in a workspace.');
            return;
        }

        const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');
        
        if (!fs.existsSync(gitignorePath)) {
            const selection = await vscode.window.showWarningMessage(
                '.gitignore file does not exist in the workspace root. Do you want to create it?',
                'Create .gitignore',
                'Cancel'
            );

            if (selection !== 'Create .gitignore') return;
            fs.writeFileSync(gitignorePath, '');
        }

        let relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
        relativePath = relativePath.split(path.sep).join('/');

        const extension = path.extname(relativePath);
        
        const options: vscode.QuickPickItem[] = [
            { label: relativePath, description: 'Add specific file' }
        ];

        if (extension) {
            options.push({ label: `*${extension}`, description: `Add all ${extension} files` });
        }
        
        options.push({ label: 'Custom pattern...', description: 'Enter a custom gitignore pattern' });

        const selection = await vscode.window.showQuickPick(options, {
            placeHolder: 'Select what to add to .gitignore'
        });

        if (!selection) return;

        let patternToAdd = selection.label;

        if (patternToAdd === 'Custom pattern...') {
            const input = await vscode.window.showInputBox({ 
                prompt: 'Enter pattern to ignore',
                value: relativePath
            });
            if (!input) return;
            patternToAdd = input;
        }

        try {
            let content = '';
            if (fs.existsSync(gitignorePath)) {
                content = fs.readFileSync(gitignorePath, 'utf8');
            }

            const lines = content.split(/\r?\n/);
            if (lines.includes(patternToAdd) || lines.includes(`/${patternToAdd}`)) {
                vscode.window.showInformationMessage(`${patternToAdd} is already in .gitignore`);
                return;
            }

            const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
            fs.appendFileSync(gitignorePath, `${prefix}${patternToAdd}\n`);
            
            vscode.window.showInformationMessage(`Added ${patternToAdd} to .gitignore`);
            const doc = await vscode.workspace.openTextDocument(gitignorePath);
            await vscode.window.showTextDocument(doc);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add to .gitignore: ${error}`);
        }
    });

    const removeFromGitignoreCommand = vscode.commands.registerCommand('extension.removeFromGitignore', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No file selected.');
            return;
        }
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) return;

        const gitignorePath = path.join(workspaceFolder.uri.fsPath, '.gitignore');
        if (!fs.existsSync(gitignorePath)) {
            vscode.window.showErrorMessage('.gitignore file does not exist.');
            return;
        }

        let relativePath = path.relative(workspaceFolder.uri.fsPath, uri.fsPath);
        relativePath = relativePath.split(path.sep).join('/');

        try {
            const content = fs.readFileSync(gitignorePath, 'utf8');
            const lines = content.split(/\r?\n/);
            
            const newLines = lines.filter(line => {
                const trimmed = line.trim();
                return trimmed !== relativePath && trimmed !== `/${relativePath}` && trimmed !== relativePath + '/' && trimmed !== `/${relativePath}/`;
                // Add more robust check? For now this covers simple cases.
            });

            if (newLines.length === lines.length) {
                vscode.window.showInformationMessage(`${relativePath} was not found in .gitignore.`);
                return;
            }

            fs.writeFileSync(gitignorePath, newLines.join('\n'));
            vscode.window.showInformationMessage(`Removed ${relativePath} from .gitignore`);
            
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update .gitignore: ${error}`);
        }
    });

    const generateGitignoreCommand = vscode.commands.registerCommand('extension.generateGitignore', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const gitignorePath = path.join(rootPath, '.gitignore');

        // Fetch templates
        try {
            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Fetching gitignore templates...",
                cancellable: false
            }, async () => {
                const templates = await fetchGithubTemplates();
                if (!templates || templates.length === 0) {
                    vscode.window.showErrorMessage('Failed to fetch templates or no templates found.');
                    return;
                }

                const items = templates.map(t => ({ label: t.name.replace('.gitignore', ''), description: t.name, url: t.download_url }));
                const selection = await vscode.window.showQuickPick(items, { placeHolder: 'Select a .gitignore template' });

                if (selection && selection.url) {
                    const content = await fetchUrl(selection.url);
                    
                    if (fs.existsSync(gitignorePath)) {
                        const append = await vscode.window.showWarningMessage('.gitignore already exists. Overwrite or Append?', 'Overwrite', 'Append');
                        if (append === 'Overwrite') {
                            fs.writeFileSync(gitignorePath, content);
                        } else if (append === 'Append') {
                             fs.appendFileSync(gitignorePath, '\n' + content);
                        } else {
                            return;
                        }
                    } else {
                        fs.writeFileSync(gitignorePath, content);
                    }
                    vscode.window.showInformationMessage(`Generated .gitignore for ${selection.label}`);
                    const doc = await vscode.workspace.openTextDocument(gitignorePath);
                    await vscode.window.showTextDocument(doc);
                }
            });
        } catch (error) {
            vscode.window.showErrorMessage(`Error generating .gitignore: ${error}`);
        }
    });

    const cleanupGitignoreCommand = vscode.commands.registerCommand('extension.cleanupGitignore', async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const folder = workspaceFolders[0];
        const gitignorePath = path.join(folder.uri.fsPath, '.gitignore');

        if (!fs.existsSync(gitignorePath)) {
            vscode.window.showInformationMessage('No .gitignore found to clean.');
            return;
        }

        try {
            const content = fs.readFileSync(gitignorePath, 'utf8');
            const lines = content.split(/\r?\n/);
            const uniqueLines = new Set<string>();
            const cleanedLines: string[] = [];
            
            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#') && !uniqueLines.has(trimmed)) {
                    uniqueLines.add(trimmed);
                    cleanedLines.push(trimmed);
                }
            }
            cleanedLines.sort();
            fs.writeFileSync(gitignorePath, cleanedLines.join('\n') + '\n');
            vscode.window.showInformationMessage('.gitignore cleaned and sorted.');
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to clean .gitignore: ${error}`);
        }
    });

    const checkIgnoreCommand = vscode.commands.registerCommand('extension.checkIgnore', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No file selected.');
            return;
        }
        
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(uri);
        if (!workspaceFolder) return;

        try {
            const { stdout } = await exec(`git check-ignore -v "${uri.fsPath}"`, { cwd: workspaceFolder.uri.fsPath });
            const output = stdout.trim();
            
            if (output) {
                // Output format: source:linenum:pattern path
                // e.g. .gitignore:3:*.log test.log
                // Handle different OS formats or split limits if path contains colons? 
                // git check-ignore -v usually outputs with colons separator.
                
                // Naive split by colon might fail on windows paths in source if absolute?
                // Usually git output relative path for source if in repo.
                
                const parts = output.split(':');
                let source = parts[0];
                let lineNum = parts[1];
                let pattern = parts.slice(2).join(':').split('\t')[0].split(' ')[0]; // pattern might be followed by tab or space then path
                
                // Better regex parsing
                // <source>: <lineNum>: <pattern> <tab/space> <path>
                // But source could have colons (windows).
                // If checking inside repo, source is usually relative ".gitignore".
                // If global, it's absolute.
                
                // Let's try match
                const match = output.match(/^(.+):(\d+):(.*)\s+.*$/);
                if (match) {
                     source = match[1];
                     lineNum = match[2];
                     pattern = match[3].trim();
                }

                const message = `File is ignored by pattern "${pattern}" in "${source}" at line ${lineNum}.`;
                
                const openAction = 'Open Rule';
                const removeAction = 'Remove Rule';
                
                const selection = await vscode.window.showInformationMessage(message, { modal: true, detail: 'Select an action to perform.' }, openAction, removeAction);
                
                if (selection === openAction) {
                    let docUri: vscode.Uri | undefined;
                    if (path.isAbsolute(source)) {
                        docUri = vscode.Uri.file(source);
                    } else {
                        docUri = vscode.Uri.file(path.join(workspaceFolder.uri.fsPath, source));
                    }
                    
                    if (fs.existsSync(docUri.fsPath)) {
                        const doc = await vscode.workspace.openTextDocument(docUri);
                        const editor = await vscode.window.showTextDocument(doc);
                        const line = parseInt(lineNum) - 1;
                        if (line >= 0) {
                            const range = new vscode.Range(line, 0, line, 0);
                            editor.selection = new vscode.Selection(range.start, range.end);
                            editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
                        }
                    } else {
                        vscode.window.showErrorMessage(`Could not find ignore file: ${source}`);
                    }
                } else if (selection === removeAction) {
                     let docPath: string;
                     if (path.isAbsolute(source)) {
                        docPath = source;
                    } else {
                        docPath = path.join(workspaceFolder.uri.fsPath, source);
                    }
                    
                    if (fs.existsSync(docPath)) {
                        const content = fs.readFileSync(docPath, 'utf8');
                        const lines = content.split(/\r?\n/);
                        const index = parseInt(lineNum) - 1;
                        
                        // Verification: check if line content kind of matches pattern?
                        if (index >= 0 && index < lines.length) {
                             // Remove the line
                             lines.splice(index, 1);
                             fs.writeFileSync(docPath, lines.join('\n'));
                             vscode.window.showInformationMessage(`Removed rule "${pattern}" from ${source}.`);
                        } else {
                             vscode.window.showErrorMessage(`Line number ${lineNum} out of range in ${source}.`);
                        }
                    } else {
                        vscode.window.showErrorMessage(`Could not find ignore file: ${source}`);
                    }
                }

            } else {
                vscode.window.showInformationMessage('File is NOT ignored.', { modal: true });
            }
        } catch (error: any) {
             if (error.code === 1) {
                vscode.window.showInformationMessage('File is NOT ignored.', { modal: true });
             } else {
                vscode.window.showErrorMessage(`Error checking ignore status: ${error}`);
             }
        }
    });

    const addToGlobalGitignoreCommand = vscode.commands.registerCommand('extension.addToGlobalGitignore', async (uri: vscode.Uri) => {
        if (!uri) {
            vscode.window.showErrorMessage('No file selected.');
            return;
        }

        try {
            let { stdout: globalIgnorePath } = await exec('git config --get core.excludesfile');
            globalIgnorePath = globalIgnorePath.trim();

            if (!globalIgnorePath) {
                const homeDir = process.env.HOME || process.env.USERPROFILE;
                if (!homeDir) {
                    vscode.window.showErrorMessage('Could not determine home directory.');
                    return;
                }
                globalIgnorePath = path.join(homeDir, '.gitignore_global');
                
                const selection = await vscode.window.showWarningMessage(
                    `Global .gitignore is not configured. Do you want to use ${globalIgnorePath}?`,
                    'Yes', 'Cancel'
                );
                
                if (selection !== 'Yes') return;
                
                await exec(`git config --global core.excludesfile "${globalIgnorePath}"`);
                vscode.window.showInformationMessage(`Configured core.excludesfile to ${globalIgnorePath}`);
            }
            
             if (globalIgnorePath.startsWith('~')) {
                const homeDir = process.env.HOME || process.env.USERPROFILE || '';
                globalIgnorePath = path.join(homeDir, globalIgnorePath.slice(1));
            }

            if (!fs.existsSync(globalIgnorePath)) {
                fs.writeFileSync(globalIgnorePath, '');
            }

            const content = fs.readFileSync(globalIgnorePath, 'utf8');
            const pattern = path.basename(uri.fsPath);
            
             const options: vscode.QuickPickItem[] = [
                { label: pattern, description: 'Add specific file name' },
                { label: `*${path.extname(uri.fsPath)}`, description: `Add all ${path.extname(uri.fsPath)} files` },
                { label: 'Custom pattern...' }
            ];
             const selection = await vscode.window.showQuickPick(options, { placeHolder: 'Add to Global Gitignore' });
             if (!selection) return;

             let patternToAdd = selection.label;
             if (patternToAdd === 'Custom pattern...') {
                 const input = await vscode.window.showInputBox({ value: pattern });
                 if (!input) return;
                 patternToAdd = input;
             }

            if (content.split(/\r?\n/).includes(patternToAdd)) {
                vscode.window.showInformationMessage(`${patternToAdd} is already in global .gitignore`);
                return;
            }

            const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
            fs.appendFileSync(globalIgnorePath, `${prefix}${patternToAdd}\n`);
            vscode.window.showInformationMessage(`Added ${patternToAdd} to global .gitignore`);

        } catch (error) {
            vscode.window.showErrorMessage(`Failed to add to global .gitignore: ${error}`);
        }
    });

    context.subscriptions.push(
        addToGitignoreCommand, 
        removeFromGitignoreCommand,
        generateGitignoreCommand,
        cleanupGitignoreCommand,
        checkIgnoreCommand,
        addToGlobalGitignoreCommand
    );

    const provider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', pattern: '**/.gitignore' },
        new GitignoreCompletionProvider(),
        '/' // Trigger on slash
    );
    context.subscriptions.push(provider);
}

function fetchGithubTemplates(): Promise<any[]> {
    return new Promise((resolve, reject) => {
        const options = {
            hostname: 'api.github.com',
            path: '/repos/github/gitignore/contents',
            headers: { 'User-Agent': 'VSCode-Gitignore-Helper' }
        };
        https.get(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    if (Array.isArray(json)) {
                        resolve(json.filter((item: any) => item.name.endsWith('.gitignore')));
                    } else {
                        resolve([]);
                    }
                } catch (e) {
                    reject(e);
                }
            });
        }).on('error', reject);
    });
}

function fetchUrl(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'VSCode-Gitignore-Helper' } }, (res) => {
             let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

export function deactivate() {}

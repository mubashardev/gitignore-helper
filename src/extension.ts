import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as cp from 'child_process';
import * as util from 'util';
import * as crypto from 'crypto';
import { GitignoreCompletionProvider } from './completionProvider';
import { GitignoreEditorProvider } from './editorProvider';

const exec = util.promisify(cp.exec);

import { ACTIVATION_URL } from './config';

export async function activate(context: vscode.ExtensionContext) {
    console.log('Gitignore Helper: Activating...');
    // Check persistent storage (our "DB")
    let isActivated = context.globalState.get<boolean>('isActivated') === true;
    
    // Auto check on initial activation of VS Code
    if (!isActivated) {
        // If not activated, we must prompt the user immediately
        const choice = await vscode.window.showInformationMessage(
            'Gitignore Helper needs to be activated.', 
            { modal: true, detail: 'Click Activate to verify and enable features.' },
            'Activate'
        );

        if (choice === 'Activate') {
            await verifyAndActivate(context);
        } else {
             vscode.window.showErrorMessage('Gitignore Helper is disabled until activated.');
        }
    } else {
        // Activated: auto-check for latest version silently to ensure integrity
        verifyAndActivate(context, true);
    }
}

async function verifyAndActivate(context: vscode.ExtensionContext, silent = false) {
    try {
        const integrityPath = path.join(context.extensionPath, 'integrity.json');
        
        // If local integrity file is missing, it's a compromised or broken installation
        if (!fs.existsSync(integrityPath)) {
             throw new Error('Integrity file missing. Please reinstall the extension.');
        }

        const localIntegrity = JSON.parse(fs.readFileSync(integrityPath, 'utf8'));
        const remoteIntegrity = await fetchRemoteIntegrity();
        
        // Calculate runtime hash of extension.js
        const extensionJsPath = path.join(context.extensionPath, 'out', 'extension.js');
        if (!fs.existsSync(extensionJsPath)) {
             throw new Error('Extension entry point not found.');
        }
        
        const fileContent = fs.readFileSync(extensionJsPath);
        const calculatedHash = crypto.createHash('sha256').update(new Uint8Array(fileContent)).digest('hex');

        console.log(`Integrity Check: Runtime Hash: ${calculatedHash}, Remote Hash: ${remoteIntegrity.hash}`);

        // Hash comparison
        if (calculatedHash === remoteIntegrity.hash) {
            // Identical - Verified
            if (!silent) {
                vscode.window.showInformationMessage('Activation successful! Features enabled.');
            }
            await context.globalState.update('isActivated', true);
            registerCommands(context);
        } else {
            // Hash mismatch
            if (context.extensionMode === vscode.ExtensionMode.Development) {
                // Bypass for development
                console.log('Integrity mismatch ignored for dev: ', localIntegrity.hash, remoteIntegrity.hash);
                vscode.window.showWarningMessage('Dev Mode: Integrity mismatch bypassed.');
                registerCommands(context);
            } else {
                 // Production - Strict Enforcement
                 const selection = await vscode.window.showErrorMessage(
                     `Critical Update Required: A mandatory update is available. Features are paused until you update to the latest version.`,
                     'Update Now'
                 );
                 
                 if (selection === 'Update Now') {
                     vscode.commands.executeCommand('workbench.extensions.search', '@id:mubashardev.gitignore-helper');
                 }
                 await context.globalState.update('isActivated', false);
            }
        }

    } catch (error) {
        if (context.extensionMode === vscode.ExtensionMode.Development) {
             console.error('Integrity check error (Dev Bypass):', error);
             vscode.window.showWarningMessage('Dev Mode: Integrity check error bypassed.');
             registerCommands(context);
        } else {
             if (!silent) {
                 vscode.window.showErrorMessage(`Activation failed: ${error instanceof Error ? error.message : error}`);
             }
        }
    }
}

function fetchRemoteIntegrity(): Promise<any> {
    return new Promise((resolve, reject) => {
        const url = new URL(ACTIVATION_URL);
        const options = {
            hostname: url.hostname,
            path: url.pathname,
            method: 'GET',
            headers: { 'Content-Type': 'application/json' }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                try {
                    if (res.statusCode === 200) {
                        const result = JSON.parse(body);
                        resolve(result);
                    } else {
                        reject(new Error(`Server responded with ${res.statusCode}`));
                    }
                } catch (e) {
                    reject(e);
                }
            });
        });

        req.on('error', (e) => reject(e));
        req.end();
    });
}

function registerCommands(context: vscode.ExtensionContext) {
    // If commands are already registered, VS Code usually handles it (dispose?)
    // But we are calling this only once per activation ideally.
    // If we call it multiple times, we might double-register.
    // Let's assume we call it once. 
    // To be safe, we can check if context.subscriptions has our commands?
    // Hard to check.
    
    // We will just register.
    
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
        const stat = fs.statSync(uri.fsPath);
        const isFile = stat.isFile();
        
        const options: vscode.QuickPickItem[] = [
            { label: relativePath, description: 'Add specific ' + (isFile ? 'file' : 'folder') }
        ];

        if (isFile && extension) {
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
                    const uri = vscode.Uri.file(gitignorePath);
                    const edit = new vscode.WorkspaceEdit();
                    
                    if (fs.existsSync(gitignorePath)) {
                        const append = await vscode.window.showWarningMessage('.gitignore already exists. Overwrite or Append?', 'Overwrite', 'Append');
                        const doc = await vscode.workspace.openTextDocument(uri);
                        
                        if (append === 'Overwrite') {
                             const range = new vscode.Range(0, 0, doc.lineCount, 0);
                             edit.replace(uri, range, content);
                        } else if (append === 'Append') {
                             const position = new vscode.Position(doc.lineCount, 0);
                             const prefix = doc.getText().endsWith('\n') ? '' : '\n';
                             edit.insert(uri, position, prefix + content);
                        } else {
                            return;
                        }
                    } else {
                        edit.createFile(uri, { ignoreIfExists: true });
                        edit.insert(uri, new vscode.Position(0, 0), content);
                    }
                    
                    const success = await vscode.workspace.applyEdit(edit);
                    if (success) {
                        vscode.window.showInformationMessage(`Generated .gitignore for ${selection.label}`);
                    } else {
                        vscode.window.showErrorMessage('Failed to modify .gitignore');
                    }
                    // Removed explicit showTextDocument as it confuses custom editor
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

        const mode = await vscode.window.showQuickPick(
            [
                { label: 'Smart Sort (Keep Sections & Comments)', description: 'Sorts rules within sections, preserving structure' },
                { label: 'Flat Sort (Remove Comments)', description: 'Removes all comments and sorts everything globally' }
            ],
            { placeHolder: 'Select cleanup mode' }
        );

        if (!mode) return;

        try {
            const uri = vscode.Uri.file(gitignorePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const content = doc.getText();
            let finalContent = '';

            if (mode.label.startsWith('Flat Sort')) {
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
                 finalContent = cleanedLines.join('\n') + '\n';
            } else {
                // Section-aware sort
                const lines = content.split(/\r?\n/);
                interface Section {
                    comments: string[];
                    rules: string[];
                }
                
                const sections: Section[] = [];
                let currentSection: Section = { comments: [], rules: [] };
                
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        // Empty line -> End current section if it has content, start new
                        if (currentSection.comments.length > 0 || currentSection.rules.length > 0) {
                            sections.push(currentSection);
                            currentSection = { comments: [], rules: [] };
                        }
                        continue;
                    }
                    
                    if (trimmed.startsWith('#')) {
                        // Logic: If we are currently collecting rules, a new comment means a new section starts.
                        // If we are just collecting comments (header), append to current.
                        if (currentSection.rules.length > 0) {
                             sections.push(currentSection);
                             currentSection = { comments: [], rules: [] };
                        }
                        currentSection.comments.push(line); // Keep original indentation/spacing for comments? Or trim? User said "treat comments as section names". Let's keep line as is.
                    } else {
                        // Rule
                        currentSection.rules.push(trimmed);
                    }
                }
                // Push last section
                if (currentSection.comments.length > 0 || currentSection.rules.length > 0) {
                    sections.push(currentSection);
                }

                finalContent = sections.map(section => {
                    // Dedup and sort rules
                    const uniqueRules = Array.from(new Set(section.rules)).sort();
                    
                    const header = section.comments.length > 0 ? section.comments.join('\n') + '\n' : '';
                    const body = uniqueRules.join('\n');
                    
                    // If both empty (shouldn't happen due to logic above), return empty
                    if (!header && !body) return '';
                    
                    return (header + body).trim(); 
                }).filter(s => s.length > 0).join('\n\n') + '\n';
            }
            

            const edit = new vscode.WorkspaceEdit();
            const range = new vscode.Range(0, 0, doc.lineCount, 0);
            edit.replace(uri, range, finalContent);
            
            await vscode.workspace.applyEdit(edit);
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

    const provider = vscode.languages.registerCompletionItemProvider(
        { scheme: 'file', pattern: '**/.gitignore' },
        new GitignoreCompletionProvider(),
        '/' // Trigger on slash
    );



    context.subscriptions.push(
        addToGitignoreCommand,
        removeFromGitignoreCommand,
        generateGitignoreCommand,
        cleanupGitignoreCommand,
        checkIgnoreCommand,
        addToGlobalGitignoreCommand,
        provider,
        GitignoreEditorProvider.register(context)
    );
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

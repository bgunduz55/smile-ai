import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class RulesService {
    private static instance: RulesService;
    private constructor() {}

    public static getInstance(): RulesService {
        if (!RulesService.instance) {
            RulesService.instance = new RulesService();
        }
        return RulesService.instance;
    }

    public async createRule(workspaceFolder: vscode.WorkspaceFolder, ruleName: string): Promise<void> {
        try {
            const smileFolder = path.join(workspaceFolder.uri.fsPath, '.smile');
            const rulesFolder = path.join(smileFolder, 'rules');

            // Create folders
            if (!fs.existsSync(smileFolder)) {
                fs.mkdirSync(smileFolder);
            }

            if (!fs.existsSync(rulesFolder)) {
                fs.mkdirSync(rulesFolder);
            }

            const ruleFile = path.join(rulesFolder, `${ruleName}.md`);
            if (fs.existsSync(ruleFile)) {
                throw new Error('This name rule set already exists');
            }

            // Create rule template
            const template = `# ${ruleName}

## Description
Write the purpose and scope of this rule set here.


## General Rules
- Rule 1
- Rule 2
- Rule 3


## Examples
### Correct Usage
\`\`\`typescript
// Correct code example
\`\`\`


### Incorrect Usage
\`\`\`typescript
// Incorrect code example
\`\`\`


## References
- [Reference 1](link1)
- [Reference 2](link2)
`;


            fs.writeFileSync(ruleFile, template);

            // Enable rule
            const config = vscode.workspace.getConfiguration('smile-ai.rules');
            const enabledRules = config.get<string[]>('enabledRules', []);

            if (!enabledRules.includes(ruleName)) {
                await config.update('enabledRules', 
                    [...enabledRules, ruleName], 
                    vscode.ConfigurationTarget.Workspace
                );
            }

            // Open file in editor
            const doc = await vscode.workspace.openTextDocument(ruleFile);
            await vscode.window.showTextDocument(doc);


        } catch (error) {
            vscode.window.showErrorMessage('Rule set creation error: ' + 
                (error instanceof Error ? error.message : 'Unknown error'));
        }

    }

    public async editRule(workspaceFolder: vscode.WorkspaceFolder, ruleName: string): Promise<void> {
        try {
            const ruleFile = path.join(workspaceFolder.uri.fsPath, '.smile', 'rules', `${ruleName}.md`);
            if (!fs.existsSync(ruleFile)) {
                const create = await vscode.window.showQuickPick(['Yes', 'No'], {
                    placeHolder: 'Rule set not found. Do you want to create a new one?'
                });


                if (create === 'Yes') {
                    await this.createRule(workspaceFolder, ruleName);
                }

                return;
            }

            const doc = await vscode.workspace.openTextDocument(ruleFile);
            await vscode.window.showTextDocument(doc);

        } catch (error) {
            vscode.window.showErrorMessage('Rule set editing error: ' + 
                (error instanceof Error ? error.message : 'Unknown error'));
        }

    }

    public async viewRules(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        try {
            const rulesFolder = path.join(workspaceFolder.uri.fsPath, '.smile', 'rules');
            if (!fs.existsSync(rulesFolder)) {
                vscode.window.showInformationMessage('No rule set found');
                return;
            }


            const files = fs.readdirSync(rulesFolder).filter(f => f.endsWith('.md'));
            if (files.length === 0) {
                vscode.window.showInformationMessage('No rule set found');
                return;
            }


            const selected = await vscode.window.showQuickPick(files.map(f => ({
                label: path.basename(f, '.md'),
                description: 'View rule set'
            })));


            if (selected) {
                const doc = await vscode.workspace.openTextDocument(
                    path.join(rulesFolder, `${selected.label}.md`)
                );
                await vscode.window.showTextDocument(doc);
            }

        } catch (error) {
            vscode.window.showErrorMessage('Rule sets viewing error: ' + 
                (error instanceof Error ? error.message : 'Unknown error'));
        }

    }

    public async loadRules(workspaceFolder: vscode.WorkspaceFolder): Promise<void> {
        try {
            const rulesFolder = path.join(workspaceFolder.uri.fsPath, '.smile', 'rules');
            if (!fs.existsSync(rulesFolder)) {
                return;
            }

            const files = fs.readdirSync(rulesFolder).filter(f => f.endsWith('.md'));
            const config = vscode.workspace.getConfiguration('smile-ai.rules');
            const enabledRules = config.get<string[]>('enabledRules', []);

            // Disable deleted rules
            const existingRules = files.map(f => path.basename(f, '.md'));
            const updatedEnabledRules = enabledRules.filter(r => existingRules.includes(r));


            if (updatedEnabledRules.length !== enabledRules.length) {
                await config.update('enabledRules', updatedEnabledRules, vscode.ConfigurationTarget.Workspace);
            }

        } catch (error) {
            vscode.window.showErrorMessage('Rule sets loading error: ' + 
                (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
} 
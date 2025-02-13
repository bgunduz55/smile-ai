import * as vscode from 'vscode';

export interface AIModel {
    name: string;
    provider: 'ollama' | 'lmstudio';
    modelName: string;
    apiEndpoint: string;
    maxTokens?: number;
    temperature?: number;
}

export class ModelManager {
    private static instance: ModelManager;
    private models: AIModel[] = [];
    private activeModel: AIModel | undefined;

    private constructor() {
        this.loadModels();
    }

    public static getInstance(): ModelManager {
        if (!ModelManager.instance) {
            ModelManager.instance = new ModelManager();
        }
        return ModelManager.instance;
    }

    private loadModels() {
        const config = vscode.workspace.getConfiguration('smile-ai');
        this.models = config.get<AIModel[]>('models') || [];
        const activeModelName = config.get<string>('activeModel');
        
        if (activeModelName) {
            this.activeModel = this.models.find(m => m.name === activeModelName);
        } else if (this.models.length > 0) {
            this.activeModel = this.models[0];
            this.setActiveModel(this.models[0].name);
        }
    }

    public async addModel(model: AIModel): Promise<void> {
        // Model adı benzersiz olmalı
        if (this.models.some(m => m.name === model.name)) {
            throw new Error(`Model with name "${model.name}" already exists`);
        }

        this.models.push(model);
        await this.saveModels();

        // İlk model ise aktif model olarak ayarla
        if (this.models.length === 1) {
            await this.setActiveModel(model.name);
        }
    }

    public async removeModel(modelName: string): Promise<void> {
        const index = this.models.findIndex(m => m.name === modelName);
        if (index === -1) {
            throw new Error(`Model "${modelName}" not found`);
        }

        this.models.splice(index, 1);
        await this.saveModels();

        // Aktif model silindiyse başka bir model seç
        if (this.activeModel?.name === modelName) {
            if (this.models.length > 0) {
                await this.setActiveModel(this.models[0].name);
            } else {
                this.activeModel = undefined;
                await this.setActiveModel(undefined);
            }
        }
    }

    public async setActiveModel(modelName: string | undefined): Promise<void> {
        if (modelName) {
            const model = this.models.find(m => m.name === modelName);
            if (!model) {
                throw new Error(`Model "${modelName}" not found`);
            }
            this.activeModel = model;
        } else {
            this.activeModel = undefined;
        }

        await vscode.workspace.getConfiguration('smile-ai').update(
            'activeModel',
            modelName,
            vscode.ConfigurationTarget.Global
        );
    }

    private async saveModels(): Promise<void> {
        await vscode.workspace.getConfiguration('smile-ai').update(
            'models',
            this.models,
            vscode.ConfigurationTarget.Global
        );
    }

    public getModels(): AIModel[] {
        return [...this.models];
    }

    public getActiveModel(): AIModel | undefined {
        return this.activeModel;
    }

    public async promptAddModel(): Promise<void> {
        const name = await vscode.window.showInputBox({
            prompt: 'Enter a name for the model',
            placeHolder: 'e.g., My CodeLlama'
        });
        if (!name) return;

        const provider = await vscode.window.showQuickPick(
            ['ollama', 'lmstudio'],
            { placeHolder: 'Select AI provider' }
        );
        if (!provider) return;

        const modelName = await vscode.window.showInputBox({
            prompt: 'Enter the model name',
            placeHolder: 'e.g., codellama'
        });
        if (!modelName) return;

        const apiEndpoint = await vscode.window.showInputBox({
            prompt: 'Enter the API endpoint',
            placeHolder: 'http://localhost:11434',
            value: 'http://localhost:11434'
        });
        if (!apiEndpoint) return;

        const maxTokens = await vscode.window.showInputBox({
            prompt: 'Enter max tokens (optional)',
            placeHolder: '2048',
            value: '2048'
        });

        const temperature = await vscode.window.showInputBox({
            prompt: 'Enter temperature (optional)',
            placeHolder: '0.7',
            value: '0.7'
        });

        const model: AIModel = {
            name,
            provider: provider as 'ollama' | 'lmstudio',
            modelName,
            apiEndpoint,
            maxTokens: maxTokens ? parseInt(maxTokens) : undefined,
            temperature: temperature ? parseFloat(temperature) : undefined
        };

        await this.addModel(model);
    }

    public async promptSelectActiveModel(): Promise<void> {
        const modelNames = this.models.map(m => m.name);
        if (modelNames.length === 0) {
            vscode.window.showInformationMessage('No models configured. Please add a model first.');
            return;
        }

        const selected = await vscode.window.showQuickPick(modelNames, {
            placeHolder: 'Select active model'
        });

        if (selected) {
            await this.setActiveModel(selected);
        }
    }
} 
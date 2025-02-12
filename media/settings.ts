// @ts-check

import { ExtensionSettings, ModelProvider, ThemeSettings, SecuritySettings, ShortcutSettings } from '../src/models/settings';

declare global {
    interface Window {
        acquireVsCodeApi: () => {
            postMessage: (message: any) => void;
            getState: () => any;
            setState: (state: any) => void;
        };
    }
}

const vscode = window.acquireVsCodeApi();

interface WebviewMessage {
    type: string;
    settings?: ExtensionSettings;
    provider?: ModelProvider;
        apiKey?: string;
}

class SettingsManager {
    private settings: ExtensionSettings;

    constructor() {
        this.settings = vscode.getState()?.settings || {};
        this.initializeEventListeners();
        this.renderSettings();
    }

    private initializeEventListeners(): void {
        window.addEventListener('message', (event: MessageEvent<WebviewMessage>) => {
        const message = event.data;

            switch (message.type) {
                case 'updateSettings':
                    if (message.settings) {
                        this.settings = message.settings;
                        this.renderSettings();
                        vscode.setState({ settings: this.settings });
                    }
                    break;
            }
        });

        document.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLElement;
            if (target.classList.contains('setting-input')) {
                this.handleSettingChange(target);
            }
        });
    }

    private handleSettingChange(element: HTMLElement): void {
        const settingType = element.getAttribute('data-setting-type');
        const settingKey = element.getAttribute('data-setting-key');
        const value = (element as HTMLInputElement | HTMLSelectElement).value;

        if (!settingType || !settingKey) return;

        let updatedValue: any = value;
        if (element.getAttribute('type') === 'number') {
            updatedValue = Number(value);
        } else if (element.getAttribute('type') === 'checkbox') {
            updatedValue = (element as HTMLInputElement).checked;
        }

        const updatedSettings = { ...this.settings };
        switch (settingType) {
            case 'provider':
                if (!updatedSettings.providers) updatedSettings.providers = {} as Record<ModelProvider, any>;
                updatedSettings.providers[settingKey as ModelProvider] = {
                    ...updatedSettings.providers[settingKey as ModelProvider],
                    ...updatedValue
                };
                break;
            case 'theme':
                if (!updatedSettings.theme) updatedSettings.theme = {} as ThemeSettings;
                updatedSettings.theme = { ...updatedSettings.theme, [settingKey]: updatedValue };
                break;
            case 'security':
                if (!updatedSettings.security) updatedSettings.security = {} as SecuritySettings;
                updatedSettings.security = { ...updatedSettings.security, [settingKey]: updatedValue };
                break;
            case 'shortcut':
                if (!updatedSettings.shortcuts) updatedSettings.shortcuts = {} as ShortcutSettings;
                updatedSettings.shortcuts = { ...updatedSettings.shortcuts, [settingKey]: updatedValue };
                break;
        }

        vscode.postMessage({
            type: 'updateSettings',
            settings: updatedSettings
        });
    }

    private renderSettings(): void {
        this.renderProviders();
        this.renderModelParameters();
        this.renderThemeSettings();
        this.renderSecuritySettings();
        this.renderShortcutSettings();
    }

    private renderProviders(): void {
        const providerList = document.getElementById('providerList');
        if (!providerList || !this.settings.providers) return;

        providerList.innerHTML = '';
        Object.entries(this.settings.providers).forEach(([provider, settings]) => {
            const card = this.createProviderCard(provider as ModelProvider, settings);
            providerList.appendChild(card);
        });
    }

    private createProviderCard(provider: ModelProvider, settings: any): HTMLElement {
        const card = document.createElement('div');
        card.className = 'provider-card';
        
        const header = document.createElement('div');
        header.className = 'header';
        
        const title = document.createElement('div');
        title.className = 'title';
        title.textContent = provider.charAt(0).toUpperCase() + provider.slice(1);
        
        const status = document.createElement('div');
        status.className = `status ${provider === this.settings.modelProvider ? 'active' : ''}`;
        status.textContent = provider === this.settings.modelProvider ? 'Active' : 'Inactive';
        
        header.appendChild(title);
        header.appendChild(status);
        
        const content = document.createElement('div');
        content.className = 'content';
        
        // Model selection
        if (settings.models?.length) {
            const modelSelect = this.createSelect(
                'Model',
                settings.model || '',
                settings.models,
                'provider',
                `${provider}.model`
            );
            content.appendChild(modelSelect);
        }
        
        // Endpoint input for local providers
        if (settings.isLocal) {
            const endpointInput = this.createInput(
                'Endpoint',
                'text',
                settings.endpoint || '',
                'provider',
                `${provider}.endpoint`
            );
            content.appendChild(endpointInput);
        }
        
        // API Key input for cloud providers
        if (settings.requiresApiKey) {
            const apiKeyInput = this.createApiKeyInput(provider, settings.apiKey || '');
            content.appendChild(apiKeyInput);
        }
        
        card.appendChild(header);
        card.appendChild(content);
        return card;
    }

    private createInput(
        label: string,
        type: string,
        value: string | number,
        settingType: string,
        settingKey: string
    ): HTMLElement {
        const container = document.createElement('div');
        container.className = 'setting-item';
        
        const labelElement = document.createElement('label');
        labelElement.textContent = label;
        
        const input = document.createElement('input');
        input.type = type;
        input.value = value.toString();
        input.className = 'setting-input';
        input.setAttribute('data-setting-type', settingType);
        input.setAttribute('data-setting-key', settingKey);
        
        container.appendChild(labelElement);
        container.appendChild(input);
        return container;
    }

    private createSelect(
        label: string,
        value: string,
        options: string[],
        settingType: string,
        settingKey: string
    ): HTMLElement {
        const container = document.createElement('div');
        container.className = 'setting-item';
        
        const labelElement = document.createElement('label');
        labelElement.textContent = label;
        
        const select = document.createElement('select');
        select.className = 'setting-input';
        select.setAttribute('data-setting-type', settingType);
        select.setAttribute('data-setting-key', settingKey);
        
        options.forEach(option => {
            const optionElement = document.createElement('option');
            optionElement.value = option;
            optionElement.textContent = option;
            optionElement.selected = option === value;
            select.appendChild(optionElement);
        });
        
        container.appendChild(labelElement);
        container.appendChild(select);
        return container;
    }

    private createApiKeyInput(provider: string, value: string): HTMLElement {
        const container = document.createElement('div');
        container.className = 'setting-item';
        
        const labelElement = document.createElement('label');
        labelElement.textContent = 'API Key';
        
        const inputContainer = document.createElement('div');
        inputContainer.className = 'api-key-input';
        
        const input = document.createElement('input');
        input.type = 'password';
        input.value = value;
        input.className = 'setting-input';
        input.setAttribute('data-setting-type', 'provider');
        input.setAttribute('data-setting-key', `${provider}.apiKey`);
        
        const toggleButton = document.createElement('button');
        toggleButton.innerHTML = '<i class="codicon codicon-eye"></i>';
        toggleButton.onclick = () => {
            input.type = input.type === 'password' ? 'text' : 'password';
            toggleButton.innerHTML = `<i class="codicon codicon-${input.type === 'password' ? 'eye' : 'eye-closed'}"></i>`;
        };
        
        inputContainer.appendChild(input);
        inputContainer.appendChild(toggleButton);
        
        container.appendChild(labelElement);
        container.appendChild(inputContainer);
        return container;
    }

    private renderModelParameters(): void {
        // Model parameters rendering implementation
    }

    private renderThemeSettings(): void {
        // Theme settings rendering implementation
    }

    private renderSecuritySettings(): void {
        // Security settings rendering implementation
    }

    private renderShortcutSettings(): void {
        // Shortcut settings rendering implementation
    }
}

// Initialize settings manager when the DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new SettingsManager();
}); 
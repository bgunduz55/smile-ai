// @ts-check

declare const acquireVsCodeApi: () => {
    postMessage: (message: any) => void;
    getState: () => any;
    setState: (state: any) => void;
};

declare global {
    interface Window {
        vscode: any;
        updateModel: (provider: string, model: string) => void;
        updateActiveModels: (provider: string, model: string, isChecked: boolean) => void;
        generateCode: () => void;
        applyChanges: () => void;
    }
}

// Initialize vscode API
const vscode = acquireVsCodeApi();
window.vscode = vscode;

// Initialize global functions
window.updateModel = (provider: string, model: string) => {
    vscode.postMessage({
        type: 'setActiveModel',
        provider,
        model
    });
};

window.updateActiveModels = (provider: string, model: string, isChecked: boolean) => {
    vscode.postMessage({
        type: isChecked ? 'setActiveModel' : 'removeActiveModel',
        provider,
        model
    });
};

window.generateCode = () => {
    const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
    vscode.postMessage({
        type: 'generateCode',
        input: promptInput.value
    });
};

window.applyChanges = () => {
    const responseOutput = document.getElementById('responseOutput') as HTMLTextAreaElement;
    vscode.postMessage({
        type: 'applyChanges',
        output: responseOutput.value
    });
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM content loaded');
    initializeAllTabs();
});

function initializeAllTabs() {
    // Add click event listeners to all tabs
    document.querySelectorAll('.tab-button').forEach(tab => {
        tab.addEventListener('click', () => {
            const tabId = tab.getAttribute('data-tab');
            if (tabId) {
                switchTab(tabId);
            }
        });
    });

    // Initialize message handlers
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message:', message);
        
        switch (message.type) {
            case 'updateContent':
                updateContent(message.content);
                break;
            case 'updateTabs':
                updateTabs(message.activeTab);
                break;
            case 'ollamaModelsLoaded':
                updateOllamaModels(message.content, message.error);
                break;
        }
    });
}

function switchTab(tabId: string) {
    console.log(`Switching to tab: ${tabId}`);
    
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(tab => {
        if (tab.getAttribute('data-tab') === tabId) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });

    // Notify extension about tab change
    vscode.postMessage({
        type: 'switchTab',
        tab: tabId
    });
}

function updateContent(content: string) {
    console.log('Updating content');
    const contentArea = document.getElementById('contentArea');
    if (contentArea) {
        contentArea.innerHTML = content;
        initializeContentHandlers();
    }
}

function updateTabs(activeTab: string) {
    document.querySelectorAll('.tab-button').forEach(tab => {
        if (tab.getAttribute('data-tab') === activeTab) {
            tab.classList.add('active');
        } else {
            tab.classList.remove('active');
        }
    });
}

function initializeContentHandlers() {
    console.log('Initializing content handlers');
    
    // Initialize chat handlers
    const chatInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    const sendButton = document.querySelector('.send-button');
    if (chatInput && sendButton) {
        sendButton.addEventListener('click', () => {
            const message = (chatInput as HTMLTextAreaElement).value.trim();
            if (message) {
                vscode.postMessage({
                    type: 'sendMessage',
                    message: message
                });
                (chatInput as HTMLTextAreaElement).value = '';
            }
        });

        chatInput.addEventListener('keydown', (event) => {
            if (event instanceof KeyboardEvent && event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                (sendButton as HTMLButtonElement).click();
            }
        });
    }

    // Initialize composer handlers
    const improveButton = document.querySelector('#improveText');
    const translateButton = document.querySelector('#translateText');
    const formatButton = document.querySelector('#formatText');

    if (improveButton || translateButton || formatButton) {
        const composerInput = document.querySelector('.message-input');
        if (composerInput) {
            if (improveButton) {
                improveButton.addEventListener('click', () => {
                    const text = (composerInput as HTMLTextAreaElement).value.trim();
                    if (text) {
                        vscode.postMessage({
                            type: 'composerOperation',
                            operation: {
                                type: 'improve',
                                text: text
                            }
                        });
                    }
                });
            }

            if (translateButton) {
                translateButton.addEventListener('click', () => {
                    const text = (composerInput as HTMLTextAreaElement).value.trim();
                    if (text) {
                        vscode.postMessage({
                            type: 'composerOperation',
                            operation: {
                                type: 'translate',
                                text: text
                            }
                        });
                    }
                });
            }

            if (formatButton) {
                formatButton.addEventListener('click', () => {
                    const text = (composerInput as HTMLTextAreaElement).value.trim();
                    if (text) {
                        vscode.postMessage({
                            type: 'composerOperation',
                            operation: {
                                type: 'format',
                                text: text
                            }
                        });
                    }
                });
            }
        }
    }

    // Initialize settings handlers
    const settingsInputs = document.querySelectorAll('[data-setting]');
    settingsInputs.forEach(input => {
        input.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement;
            const setting = target.getAttribute('data-setting');
            if (setting) {
                let value: string | boolean | string[] = target.type === 'checkbox' ? target.checked : target.value;
                
                // Handle active models array for checkboxes
                if (target.type === 'checkbox' && setting.endsWith('.activeModels')) {
                    const provider = setting.split('.')[0];
                    const modelList = document.querySelectorAll(`input[data-setting="${provider}.activeModels"]`);
                    const activeModels: string[] = [];
                    
                    modelList.forEach((checkbox: Element) => {
                        if ((checkbox as HTMLInputElement).checked) {
                            activeModels.push((checkbox as HTMLInputElement).value);
                        }
                    });
                    
                    value = activeModels;
                }

                vscode.postMessage({
                    type: 'updateSetting',
                    key: setting,
                    value: value
                });
            }
        });
    });

    // Initialize model selection handlers
    document.querySelectorAll('.model-selector').forEach(selector => {
        const provider = selector.getAttribute('data-provider');
        if (provider) {
            const select = selector.querySelector('select');
            if (select) {
                select.addEventListener('change', () => {
                    vscode.postMessage({
                        type: 'updateSetting',
                        key: `${provider}.model`,
                        value: select.value
                    });
                });
            }
        }
    });
}

function updateOllamaModels(content: string, error?: string) {
    const modelList = document.getElementById('ollamaModelList');
    if (!modelList) return;

    if (error) {
        modelList.innerHTML = `<div class="error">${error}</div>`;
        return;
    }

    modelList.innerHTML = content;

    // Add event listeners to checkboxes
    modelList.querySelectorAll('input[type="checkbox"]').forEach(checkbox => {
        checkbox.addEventListener('change', (event) => {
            const target = event.target as HTMLInputElement;
            
            // Uncheck all other checkboxes
            modelList.querySelectorAll('input[type="checkbox"]').forEach(cb => {
                if (cb !== target) {
                    (cb as HTMLInputElement).checked = false;
                }
            });

            // Update setting only if checkbox is checked
            if (target.checked) {
                vscode.postMessage({
                    type: 'updateSetting',
                    key: 'ollama.model',
                    value: target.value
                });
            }
        });
    });
}

// Export for use in other modules
export { initializeAllTabs }; 
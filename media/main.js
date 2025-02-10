// @ts-check

(function() {
    // Get VS Code API
    const vscode = (function() {
        try {
            // @ts-ignore
            return acquireVsCodeApi();
        } catch (e) {
            console.error('VS Code API is not available');
            return undefined;
        }
    })();
    
    if (!vscode) {
        console.error('VS Code API is not available');
        return;
    }
    
    // Store messages history
    let messagesHistory = [];
    
    // Initialize when the document is loaded
    document.addEventListener('DOMContentLoaded', () => {
        initializeTabs();
        initializeChat();
        initializeComposer();
        initializeSuggestions();
        initializeRules();
        initializeSettings();
    });
    
    // Tab switching functionality
    function initializeTabs() {
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabPanes = document.querySelectorAll('.tab-pane');
        
        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                if (!tabId) return;
                
                console.log('Tab button clicked:', tabId);
                
                // Update active states
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanes.forEach(pane => pane.classList.remove('active'));
                
                button.classList.add('active');
                const tabPane = document.getElementById(tabId);
                if (tabPane) {
                    tabPane.classList.add('active');
                }

                // Notify extension about tab switch
                vscode.postMessage({
                    type: 'switchTab',
                    tab: tabId
                });
            });
        });
    }
    
    // Chat functionality
    function initializeChat() {
        /** @type {HTMLTextAreaElement | null} */
        const chatInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('chatInput'));
        const sendButton = document.getElementById('sendMessage');
        const chatMessages = document.getElementById('chatMessages');
        
        if (chatInput && sendButton) {
            sendButton.addEventListener('click', () => sendMessage());
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                }
            });
        }
        
        function sendMessage() {
            if (!chatInput) return;
            const message = chatInput.value.trim();
            if (message) {
                // Add message to UI
                addMessageToChat('user', message);
                
                // Send to extension
                vscode.postMessage({
                    type: 'sendMessage',
                    message
                });

                // Clear input
                chatInput.value = '';
            }
        }
    }
    
    function addMessageToChat(role, content) {
        const chatMessages = document.getElementById('chatMessages');
        if (!chatMessages) return;
        
        const messageDiv = document.createElement('div');
        messageDiv.className = `chat-message ${role}`;
        messageDiv.textContent = content;
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }
    
    // Composer functionality
    function initializeComposer() {
        /** @type {HTMLTextAreaElement | null} */
        const composerInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('composerInput'));
        const generateButton = document.getElementById('generateCode');
        
        if (generateButton && composerInput) {
            generateButton.addEventListener('click', () => {
                /** @type {HTMLSelectElement | null} */
                const actionSelect = /** @type {HTMLSelectElement} */ (document.getElementById('composerAction'));
                /** @type {HTMLSelectElement | null} */
                const languageSelect = /** @type {HTMLSelectElement} */ (document.getElementById('language'));
                /** @type {HTMLSelectElement | null} */
                const styleSelect = /** @type {HTMLSelectElement} */ (document.getElementById('style'));
                
                if (!actionSelect || !languageSelect || !styleSelect) return;
                
                const action = actionSelect.value;
                const language = languageSelect.value;
                const style = styleSelect.value;
                const prompt = composerInput.value.trim();
                
                if (prompt) {
                    vscode.postMessage({
                        type: 'generateCode',
                        action,
                        language,
                        style,
                        prompt
                    });
                }
            });
        }
    }
    
    // Suggestions functionality
    function initializeSuggestions() {
        const refreshButton = document.getElementById('refreshSuggestions');
        const applyAllButton = document.getElementById('applyAllSuggestions');
        /** @type {HTMLSelectElement | null} */
        const suggestionType = /** @type {HTMLSelectElement} */ (document.getElementById('suggestionType'));
        
        if (refreshButton) {
            refreshButton.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'refreshSuggestions'
                });
            });
        }
        
        if (applyAllButton) {
            applyAllButton.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'applyAllSuggestions'
                });
            });
        }
        
        if (suggestionType) {
            suggestionType.addEventListener('change', () => {
                vscode.postMessage({
                    type: 'filterSuggestions',
                    filter: suggestionType.value
                });
            });
        }
    }
    
    // Rules functionality
    function initializeRules() {
        const addRuleButton = document.getElementById('addRuleSet');
        
        if (addRuleButton) {
            addRuleButton.addEventListener('click', () => {
                vscode.postMessage({
                    type: 'createRuleSet'
                });
            });
        }

        // Add event listeners for edit and delete buttons
        document.querySelectorAll('.edit-rule-set').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = /** @type {HTMLElement} */ (e.target);
                const ruleSet = target.closest('.rule-set');
                if (!ruleSet) return;
                
                const ruleSetId = ruleSet.getAttribute('data-id');
                vscode.postMessage({
                    type: 'editRuleSet',
                    ruleSetId
                });
            });
        });

        document.querySelectorAll('.delete-rule-set').forEach(button => {
            button.addEventListener('click', (e) => {
                const target = /** @type {HTMLElement} */ (e.target);
                const ruleSet = target.closest('.rule-set');
                if (!ruleSet) return;
                
                const ruleSetId = ruleSet.getAttribute('data-id');
                vscode.postMessage({
                    type: 'deleteRuleSet',
                    ruleSetId
                });
            });
        });
    }
    
    // Settings functionality
    function initializeSettings() {
        /** @type {HTMLSelectElement | null} */
        const modelProvider = /** @type {HTMLSelectElement} */ (document.getElementById('modelProvider'));
        /** @type {HTMLInputElement | null} */
        const temperature = /** @type {HTMLInputElement} */ (document.getElementById('temperature'));
        const temperatureValue = document.getElementById('temperatureValue');
        /** @type {HTMLInputElement | null} */
        const maxTokens = /** @type {HTMLInputElement} */ (document.getElementById('maxTokens'));
        
        if (modelProvider) {
            modelProvider.addEventListener('change', () => {
                vscode.postMessage({
                    type: 'updateSettings',
                    setting: 'modelProvider',
                    value: modelProvider.value
                });
            });
        }
        
        if (temperature && temperatureValue) {
            temperature.addEventListener('input', () => {
                temperatureValue.textContent = temperature.value;
                vscode.postMessage({
                    type: 'updateSettings',
                    setting: 'temperature',
                    value: parseFloat(temperature.value)
                });
            });
        }
        
        if (maxTokens) {
            maxTokens.addEventListener('change', () => {
                vscode.postMessage({
                    type: 'updateSettings',
                    setting: 'maxTokens',
                    value: parseInt(maxTokens.value)
                });
            });
        }
    }
    
    // Model provider selection
    /** @type {HTMLElement | null} */
    const modelSettings = document.getElementById('modelSettings');
    
    const providerSettings = {
        ollama: `
            <div class="setting-item">
                <label>API Endpoint</label>
                <input type="text" id="ollamaEndpoint" placeholder="http://localhost:11434">
            </div>
            <div class="setting-item">
                <label>Model</label>
                <select id="ollamaModel">
                    <option value="">Yüklü modelleri getir...</option>
                </select>
            </div>
        `,
        llamacpp: `
            <div class="setting-item">
                <label>Model Dosyası</label>
                <input type="text" id="llamaPath" placeholder="Model dosyasının yolu">
                <button onclick="selectModel()">Gözat</button>
            </div>
        `,
        openai: `
            <div class="setting-item">
                <label>API Anahtarı</label>
                <input type="text" id="openaiKey" placeholder="OpenAI API anahtarı">
            </div>
            <div class="setting-item">
                <label>Model</label>
                <select id="openaiModel">
                    <option value="gpt-4">GPT-4</option>
                    <option value="gpt-3.5-turbo">GPT-3.5 Turbo</option>
                </select>
            </div>
        `,
        anthropic: `
            <div class="setting-item">
                <label>API Anahtarı</label>
                <input type="text" id="anthropicKey" placeholder="Anthropic API anahtarı">
            </div>
            <div class="setting-item">
                <label>Model</label>
                <select id="anthropicModel">
                    <option value="claude-3-opus-20240229">Claude 3 Opus</option>
                    <option value="claude-3-sonnet-20240229">Claude 3 Sonnet</option>
                </select>
            </div>
        `
    };
    
    if (modelSettings) {
        modelSettings.addEventListener('change', async () => {
            /** @type {HTMLSelectElement} */
            const select = /** @type {HTMLSelectElement} */ (modelSettings);
            const provider = select.value;
            modelSettings.innerHTML = providerSettings[provider];
            
            if (provider === 'ollama') {
                // Get available Ollama models
                vscode.postMessage({
                    type: 'getModels',
                    provider: 'ollama'
                });
            }
        });
    }
    
    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message from extension:', message);

        switch (message.type) {
            case 'modelsLoaded':
                if (message.provider === 'ollama') {
                    const select = document.getElementById('ollamaModel');
                    if (select) {
                        select.innerHTML = message.models.map(model => 
                            `<option value="${model.name || ''}">${model.name || ''}</option>`
                        ).join('');
                    }
                }
                break;
                
            case 'loadSettings':
                // Load saved settings
                const settings = message.settings;
                if (modelSettings) {
                    /** @type {HTMLSelectElement} */
                    const select = /** @type {HTMLSelectElement} */ (modelSettings);
                    select.value = settings.provider;
                    select.dispatchEvent(new Event('change'));
                }
                
                // Load provider-specific settings
                switch (settings.provider) {
                    case 'ollama':
                        /** @type {HTMLInputElement | null} */
                        const ollamaEndpoint = /** @type {HTMLInputElement} */ (document.getElementById('ollamaEndpoint'));
                        /** @type {HTMLSelectElement | null} */
                        const ollamaModel = /** @type {HTMLSelectElement} */ (document.getElementById('ollamaModel'));
                        if (ollamaEndpoint) ollamaEndpoint.value = settings.endpoint;
                        if (ollamaModel) ollamaModel.value = settings.model;
                        break;
                    case 'llamacpp':
                        /** @type {HTMLInputElement | null} */
                        const llamaPath = /** @type {HTMLInputElement} */ (document.getElementById('llamaPath'));
                        if (llamaPath) llamaPath.value = settings.modelPath;
                        break;
                    case 'openai':
                        /** @type {HTMLInputElement | null} */
                        const openaiKey = /** @type {HTMLInputElement} */ (document.getElementById('openaiKey'));
                        /** @type {HTMLSelectElement | null} */
                        const openaiModel = /** @type {HTMLSelectElement} */ (document.getElementById('openaiModel'));
                        if (openaiKey) openaiKey.value = settings.apiKey;
                        if (openaiModel) openaiModel.value = settings.model;
                        break;
                    case 'anthropic':
                        /** @type {HTMLInputElement | null} */
                        const anthropicKey = /** @type {HTMLInputElement} */ (document.getElementById('anthropicKey'));
                        /** @type {HTMLSelectElement | null} */
                        const anthropicModel = /** @type {HTMLSelectElement} */ (document.getElementById('anthropicModel'));
                        if (anthropicKey) anthropicKey.value = settings.apiKey;
                        if (anthropicModel) anthropicModel.value = settings.model;
                        break;
                }
                
                // Load general parameters
                /** @type {HTMLInputElement | null} */
                const temperature = /** @type {HTMLInputElement} */ (document.getElementById('temperature'));
                /** @type {HTMLInputElement | null} */
                const maxTokens = /** @type {HTMLInputElement} */ (document.getElementById('maxTokens'));
                if (temperature) temperature.value = settings.temperature;
                if (maxTokens) maxTokens.value = settings.maxTokens;
                break;

            case 'updateTabContent':
                console.log('Updating tab content:', message.tabId);
                const tabPane = document.getElementById(message.tabId);
                if (tabPane) {
                    console.log('Tab content before update:', tabPane.innerHTML);
                    tabPane.innerHTML = message.content;
                    console.log('Tab content after update:', tabPane.innerHTML);

                    // Reinitialize event listeners for the new content
                    switch (message.tabId) {
                        case 'chat':
                            console.log('Reinitializing chat');
                            initializeChat();
                            break;
                        case 'composer':
                            console.log('Reinitializing composer');
                            initializeComposer();
                            break;
                        case 'suggestions':
                            console.log('Reinitializing suggestions');
                            initializeSuggestions();
                            break;
                        case 'rules':
                            console.log('Reinitializing rules');
                            initializeRules();
                            break;
                        case 'settings':
                            console.log('Reinitializing settings');
                            initializeSettings();
                            break;
                    }
                } else {
                    console.error('Tab pane not found:', message.tabId);
                }
                break;

            case 'updateProviderSettings':
                console.log('Updating provider settings');
                if (modelSettings) {
                    modelSettings.innerHTML = message.content;
                    console.log('Provider settings updated');
                }
                break;

            case 'addMessage':
                addMessageToChat(message.role, message.content);
                break;

            case 'showError':
                // TODO: Implement error display
                console.error(message.error);
                break;

            case 'ollamaModelsLoaded':
                /** @type {HTMLSelectElement | null} */
                const select = /** @type {HTMLSelectElement} */ (document.getElementById('ollamaModel'));
                if (select) {
                    // Mevcut seçili modeli sakla
                    const currentValue = select.value;
                    
                    // Modelleri listele
                    select.innerHTML = message.models.map(model => 
                        `<option value="${model.name}" ${currentValue === model.name ? 'selected' : ''}>
                            ${model.name}
                        </option>`
                    ).join('');
                    
                    // Eğer önceki seçili model listede yoksa ilk modeli seç
                    if (!select.value && select.options.length > 0) {
                        select.selectedIndex = 0;
                        // Seçili modeli güncelle
                        vscode.postMessage({
                            type: 'updateSetting',
                            key: 'ollama.model',
                            value: select.value
                        });
                    }
                }
                break;
        }
    });
    
    // Save settings
    function saveSettings() {
        /** @type {HTMLSelectElement | null} */
        const modelProvider = /** @type {HTMLSelectElement} */ (document.getElementById('modelProvider'));
        /** @type {HTMLInputElement | null} */
        const temperature = /** @type {HTMLInputElement} */ (document.getElementById('temperature'));
        /** @type {HTMLInputElement | null} */
        const maxTokens = /** @type {HTMLInputElement} */ (document.getElementById('maxTokens'));
        
        if (!modelProvider || !temperature || !maxTokens) return;
        
        const provider = modelProvider.value;
        const settings = {
            provider,
            temperature: temperature.value,
            maxTokens: maxTokens.value
        };
        
        switch (provider) {
            case 'ollama': {
                /** @type {HTMLInputElement | null} */
                const endpoint = /** @type {HTMLInputElement} */ (document.getElementById('ollamaEndpoint'));
                /** @type {HTMLSelectElement | null} */
                const model = /** @type {HTMLSelectElement} */ (document.getElementById('ollamaModel'));
                if (endpoint && model) {
                    settings.endpoint = endpoint.value;
                    settings.model = model.value;
                }
                break;
            }
            case 'llamacpp': {
                /** @type {HTMLInputElement | null} */
                const modelPath = /** @type {HTMLInputElement} */ (document.getElementById('llamaPath'));
                if (modelPath) {
                    settings.modelPath = modelPath.value;
                }
                break;
            }
            case 'openai': {
                /** @type {HTMLInputElement | null} */
                const apiKey = /** @type {HTMLInputElement} */ (document.getElementById('openaiKey'));
                /** @type {HTMLSelectElement | null} */
                const model = /** @type {HTMLSelectElement} */ (document.getElementById('openaiModel'));
                if (apiKey && model) {
                    settings.apiKey = apiKey.value;
                    settings.model = model.value;
                }
                break;
            }
            case 'anthropic': {
                /** @type {HTMLInputElement | null} */
                const apiKey = /** @type {HTMLInputElement} */ (document.getElementById('anthropicKey'));
                /** @type {HTMLSelectElement | null} */
                const model = /** @type {HTMLSelectElement} */ (document.getElementById('anthropicModel'));
                if (apiKey && model) {
                    settings.apiKey = apiKey.value;
                    settings.model = model.value;
                }
                break;
            }
        }
        
        vscode.postMessage({
            type: 'saveSettings',
            settings
        });
    }
    
    // Add event listeners for settings changes
    document.querySelectorAll('input, select').forEach(element => {
        element.addEventListener('change', saveSettings);
    });
})(); 
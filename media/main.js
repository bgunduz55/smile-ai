// @ts-check

(function() {
    // Get VS Code API
    /** @type {any} */
    const vscode = acquireVsCodeApi();
    
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
        const chatInput = document.getElementById('chatInput');
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
        const composerInput = document.getElementById('composerInput');
        const generateButton = document.getElementById('generateCode');
        
        if (generateButton) {
            generateButton.addEventListener('click', () => {
                const action = document.getElementById('composerAction').value;
                const language = document.getElementById('language').value;
                const style = document.getElementById('style').value;
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
        const suggestionType = document.getElementById('suggestionType');
        
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
                const ruleSet = e.target.closest('.rule-set');
                const ruleSetId = ruleSet.getAttribute('data-id');
                vscode.postMessage({
                    type: 'editRuleSet',
                    ruleSetId
                });
            });
        });

        document.querySelectorAll('.delete-rule-set').forEach(button => {
            button.addEventListener('click', (e) => {
                const ruleSet = e.target.closest('.rule-set');
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
        const modelProvider = document.getElementById('modelProvider');
        const temperature = document.getElementById('temperature');
        const temperatureValue = document.getElementById('temperatureValue');
        const maxTokens = document.getElementById('maxTokens');
        
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
    
    modelSettings.addEventListener('change', async () => {
        const provider = modelSettings.value;
        modelSettings.innerHTML = providerSettings[provider];
        
        if (provider === 'ollama') {
            // Get available Ollama models
            vscode.postMessage({
                type: 'getModels',
                provider: 'ollama'
            });
        }
    });
    
    // Handle messages from extension
    window.addEventListener('message', event => {
        const message = event.data;
        console.log('Received message from extension:', message);

        switch (message.type) {
            case 'modelsLoaded':
                if (message.provider === 'ollama') {
                    const select = document.getElementById('ollamaModel');
                    select.innerHTML = message.models.map(model => 
                        `<option value="${model.name}">${model.name}</option>`
                    ).join('');
                }
                break;
                
            case 'loadSettings':
                // Load saved settings
                const settings = message.settings;
                modelSettings.value = settings.provider;
                modelSettings.dispatchEvent(new Event('change'));
                
                // Load provider-specific settings
                switch (settings.provider) {
                    case 'ollama':
                        document.getElementById('ollamaEndpoint').value = settings.endpoint;
                        document.getElementById('ollamaModel').value = settings.model;
                        break;
                    case 'llamacpp':
                        document.getElementById('llamaPath').value = settings.modelPath;
                        break;
                    case 'openai':
                        document.getElementById('openaiKey').value = settings.apiKey;
                        document.getElementById('openaiModel').value = settings.model;
                        break;
                    case 'anthropic':
                        document.getElementById('anthropicKey').value = settings.apiKey;
                        document.getElementById('anthropicModel').value = settings.model;
                        break;
                }
                
                // Load general parameters
                document.getElementById('temperature').value = settings.temperature;
                document.getElementById('maxTokens').value = settings.maxTokens;
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
        }
    });
    
    // Save settings
    function saveSettings() {
        const provider = modelSettings.value;
        const settings = {
            provider,
            temperature: document.getElementById('temperature').value,
            maxTokens: document.getElementById('maxTokens').value
        };
        
        switch (provider) {
            case 'ollama':
                settings.endpoint = document.getElementById('ollamaEndpoint').value;
                settings.model = document.getElementById('ollamaModel').value;
                break;
            case 'llamacpp':
                settings.modelPath = document.getElementById('llamaPath').value;
                break;
            case 'openai':
                settings.apiKey = document.getElementById('openaiKey').value;
                settings.model = document.getElementById('openaiModel').value;
                break;
            case 'anthropic':
                settings.apiKey = document.getElementById('anthropicKey').value;
                settings.model = document.getElementById('anthropicModel').value;
                break;
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
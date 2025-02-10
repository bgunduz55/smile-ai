// @ts-check

(() => {
    let vscode;
    try {
        // @ts-ignore
        vscode = acquireVsCodeApi();
    } catch (error) {
        console.error('Error acquiring VS Code API:', error);
    }

    // Initialize when the document is loaded
    document.addEventListener('DOMContentLoaded', () => {
        console.log('Main.js: Document loaded, initializing...');
        if (vscode) {
            initializeTabs();
            initializeEventHandlers();
            initializeSettings();
        } else {
            console.error('VS Code API not available');
        }
    });

    // Tab switching functionality
    function initializeTabs() {
        console.log('Main.js: Initializing tabs...');
        const tabButtons = document.querySelectorAll('.tab-button');
        const tabPanes = document.querySelectorAll('.tab-pane');

        tabButtons.forEach(button => {
            button.addEventListener('click', () => {
                const tabId = button.getAttribute('data-tab');
                if (!tabId) return;

                console.log('Main.js: Tab button clicked:', tabId);

                // Update active states
                tabButtons.forEach(btn => btn.classList.remove('active'));
                tabPanes.forEach(pane => pane.classList.remove('active'));

                button.classList.add('active');
                const tabPane = document.getElementById(tabId);
                if (tabPane) {
                    tabPane.classList.add('active');
                }

                // Notify extension
                vscode.postMessage({
                    type: 'switchTab',
                    tab: tabId
                });
            });
        });
    }

    function initializeEventHandlers() {
        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            console.log('Main.js: Received message from extension:', message);

            switch (message.type) {
                case 'updateTabContent':
                    console.log('Main.js: Updating tab content:', message.tabId);
                    const tabPane = document.getElementById(message.tabId);
                    if (tabPane) {
                        console.log('Main.js: Tab pane found, updating content');
                        tabPane.innerHTML = message.content;

                        // Update active states
                        const tabButtons = document.querySelectorAll('.tab-button');
                        const tabPanes = document.querySelectorAll('.tab-pane');

                        tabButtons.forEach(btn => btn.classList.remove('active'));
                        tabPanes.forEach(pane => pane.classList.remove('active'));

                        const activeButton = document.querySelector(`[data-tab="${message.tabId}"]`);
                        if (activeButton) {
                            activeButton.classList.add('active');
                        }
                        tabPane.classList.add('active');

                        // Initialize event listeners for the new content
                        initializeTabContent(message.tabId);
                    } else {
                        console.error('Main.js: Tab pane not found:', message.tabId);
                    }
                    break;

                case 'showError':
                    console.error('Main.js: Error:', message.error);
                    break;

                case 'updateProviderSettings':
                    console.log('Main.js: Updating provider settings');
                    const providerSettings = document.getElementById('providerSettings');
                    if (providerSettings) {
                        providerSettings.innerHTML = message.content;
                    }
                    break;

                case 'ollamaModelsLoaded':
                    console.log('Main.js: Ollama models loaded:', message.models);
                    const ollamaModelList = document.getElementById('ollamaModelList');
                    if (ollamaModelList) {
                        if (message.error) {
                            ollamaModelList.innerHTML = `<div class="error-message">${message.error}</div>`;
                        } else if (message.models.length === 0) {
                            ollamaModelList.innerHTML = '<div class="no-models">Yüklü model bulunamadı</div>';
                        } else {
                            ollamaModelList.innerHTML = message.models.map(model => `
                                <div class="model-item">
                                    <input type="radio" name="ollamaModel" id="${model.name}" 
                                        value="${model.name}"
                                        ${model.selected ? 'checked' : ''}
                                        onchange="updateSetting('ollama.model', this.value)">
                                    <label for="${model.name}">
                                        ${model.name}
                                    </label>
                                </div>
                            `).join('');
                        }
                    }
                    break;
            }
        });
    }

    function initializeTabContent(tabId) {
        console.log('Main.js: Initializing tab content:', tabId);
        switch (tabId) {
            case 'chat':
                initializeChat();
                break;
            case 'composer':
                initializeComposer();
                break;
            case 'suggestions':
                initializeSuggestions();
                break;
            case 'rules':
                initializeRules();
                break;
            case 'settings':
                initializeSettings();
                break;
        }
    }

    function initializeChat() {
        console.log('Main.js: Initializing chat...');
        const chatInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('chatInput'));
        const sendButton = document.getElementById('sendMessage');

        if (chatInput && sendButton) {
            chatInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                }
            });

            sendButton.addEventListener('click', sendChatMessage);
        }
    }

    function sendChatMessage() {
        const chatInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('chatInput'));
        if (!chatInput) return;

        const message = chatInput.value.trim();
        if (message) {
            console.log('Main.js: Sending chat message:', message);
            vscode.postMessage({
                type: 'sendMessage',
                message: message
            });
            chatInput.value = '';
        }
    }

    function initializeComposer() {
        console.log('Main.js: Initializing composer...');
        const composerInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('composerInput'));
        const sendButton = document.getElementById('sendComposerMessage');

        if (composerInput && sendButton) {
            composerInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    sendComposerMessage();
                }
            });

            sendButton.addEventListener('click', sendComposerMessage);
        }
    }

    function sendComposerMessage() {
        const composerInput = /** @type {HTMLTextAreaElement} */ (document.getElementById('composerInput'));
        if (!composerInput) return;

        const message = composerInput.value.trim();
        if (message) {
            console.log('Main.js: Sending composer message:', message);
            vscode.postMessage({
                type: 'composerMessage',
                message: message
            });
            composerInput.value = '';
        }
    }

    function initializeSuggestions() {
        console.log('Main.js: Initializing suggestions...');
    }

    function initializeRules() {
        console.log('Main.js: Initializing rules...');
    }

    function initializeSettings() {
        // Provider seçimi için event listener'lar
        document.querySelectorAll('.provider-item').forEach(item => {
            item.addEventListener('click', function(e) {
                const target = /** @type {HTMLElement} */ (e.target);
                if (target && target.tagName === 'INPUT') return;
                
                const provider = item.getAttribute('data-provider');
                if (!provider) return;

                document.querySelectorAll('.provider-item').forEach(p => {
                    p.classList.remove('active');
                    const settings = p.querySelector('.provider-settings');
                    if (settings) settings.classList.remove('show');
                });
                
                item.classList.add('active');
                const settings = item.querySelector('.provider-settings');
                if (settings) settings.classList.add('show');

                vscode.postMessage({
                    type: 'updateSetting',
                    key: 'modelProvider',
                    value: provider
                });
            });
        });
    }

    // Global functions - attach to window object
    Object.assign(window, {
        updateSetting(key, value) {
            console.log('Main.js: Updating setting:', key, value);
            vscode.postMessage({
                type: 'updateSetting',
                key: key,
                value: value
            });
        },

        refreshOllamaModels() {
            console.log('Main.js: Refreshing Ollama models...');
            vscode.postMessage({
                type: 'refreshOllamaModels'
            });
        },

        pullOllamaModel(modelName) {
            if (!modelName) return;
            console.log('Main.js: Pulling Ollama model:', modelName);
            vscode.postMessage({
                type: 'pullOllamaModel',
                model: modelName
            });
        },

        addCustomModel(provider, modelName) {
            if (!modelName) return;
            console.log('Main.js: Adding custom model:', provider, modelName);
            vscode.postMessage({
                type: 'addCustomModel',
                provider: provider,
                model: modelName
            });
        }
    });
})(); 
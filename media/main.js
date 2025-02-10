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
        const chatInput = document.getElementById('chatInput');
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
        const chatInput = document.getElementById('chatInput');
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
        const composerInput = document.getElementById('composerInput');
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
        const composerInput = document.getElementById('composerInput');
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
        console.log('Main.js: Initializing settings...');
    }

    // Global functions
    window.updateSetting = function(key, value) {
        console.log('Main.js: Updating setting:', key, value);
        vscode.postMessage({
            type: 'updateSetting',
            key: key,
            value: value
        });
    };

    window.refreshOllamaModels = function() {
        console.log('Main.js: Refreshing Ollama models...');
        vscode.postMessage({
            type: 'refreshOllamaModels'
        });
    };

    window.pullOllamaModel = function(modelName) {
        if (!modelName) return;
        console.log('Main.js: Pulling Ollama model:', modelName);
        vscode.postMessage({
            type: 'pullOllamaModel',
            model: modelName
        });
    };

    window.addCustomModel = function(provider, modelName) {
        if (!modelName) return;
        console.log('Main.js: Adding custom model:', provider, modelName);
        vscode.postMessage({
            type: 'addCustomModel',
            provider: provider,
            model: modelName
        });
    };
})(); 
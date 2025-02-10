(function() {
    // Get VS Code API
    const vscode = acquireVsCodeApi();
    
    // Tab switching
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane');
    
    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const tabId = button.getAttribute('data-tab');
            
            // Update active states
            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanes.forEach(pane => pane.classList.remove('active'));
            
            button.classList.add('active');
            document.getElementById(tabId).classList.add('active');
        });
    });
    
    // Model provider selection
    const modelProvider = document.getElementById('modelProvider');
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
    
    modelProvider.addEventListener('change', async () => {
        const provider = modelProvider.value;
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
                modelProvider.value = settings.provider;
                modelProvider.dispatchEvent(new Event('change'));
                
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
        }
    });
    
    // Save settings
    function saveSettings() {
        const provider = modelProvider.value;
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
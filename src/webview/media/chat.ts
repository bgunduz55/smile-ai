// @ts-check

interface VSCode {
    postMessage(message: any): void;
}

declare function acquireVsCodeApi(): VSCode;

interface Message {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isEdited?: boolean;
    editedAt?: Date;
    metadata?: {
        model?: string;
        provider?: string;
        tokens?: number;
        [key: string]: any;
    };
}

interface ChatSession {
    id: string;
    name: string;
    messages: Message[];
    settings?: {
        model?: string;
        provider?: string;
        temperature?: number;
        maxTokens?: number;
        [key: string]: any;
    };
}

interface Provider {
    provider: string;
    models: string[];
}

(() => {
    const vscode = acquireVsCodeApi();
    const messagesContainer = document.getElementById('messages') as HTMLDivElement;
    const messageInput = document.getElementById('messageInput') as HTMLTextAreaElement;
    const sendButton = document.getElementById('sendButton') as HTMLButtonElement;
    const sessionSelect = document.getElementById('sessionSelect') as HTMLSelectElement;
    const providerSelect = document.getElementById('providerSelect') as HTMLSelectElement;
    const modelSelect = document.getElementById('modelSelect') as HTMLSelectElement;
    const newSessionBtn = document.getElementById('newSessionBtn') as HTMLButtonElement;
    const settingsBtn = document.getElementById('settingsBtn') as HTMLButtonElement;

    let currentSession: ChatSession | null = null;
    let currentProvider: string | null = null;

    // Initialize the webview
    window.addEventListener('load', () => {
        vscode.postMessage({ type: 'ready' });
        adjustTextareaHeight();
    });

    // Handle messages from the extension
    window.addEventListener('message', (event) => {
        const message = event.data;

        switch (message.type) {
            case 'updateMessages':
                updateMessages(message.messages);
                break;
            case 'sessionCreated':
                handleSessionCreated(message.session);
                break;
            case 'sessionsLoaded':
                updateSessionsList(message.sessions);
                break;
            case 'updateProviders':
                updateProvidersList(message.providers);
                break;
            case 'updateModels':
                updateModelsList(message.models);
                break;
            case 'settingsUpdated':
                updateSettings(message.settings);
                break;
            case 'showLoading':
                showLoading();
                break;
            case 'hideLoading':
                hideLoading();
                break;
        }
    });

    // Event Listeners
    messageInput.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    messageInput.addEventListener('input', adjustTextareaHeight);

    sendButton.addEventListener('click', sendMessage);

    sessionSelect.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLSelectElement;
        const sessionId = target.value;
        if (sessionId) {
            vscode.postMessage({
                type: 'loadSession',
                sessionId
            });
        }
    });

    providerSelect.addEventListener('change', (e: Event) => {
        const target = e.target as HTMLSelectElement;
        const provider = target.value;
        if (provider && provider !== currentProvider) {
            vscode.postMessage({
                type: 'switchProvider',
                provider
            });
            currentProvider = provider;
        }
    });

    modelSelect.addEventListener('change', (e: Event) => {
        if (!currentSession) return;

        const target = e.target as HTMLSelectElement;
        const model = target.value;
        if (model) {
            vscode.postMessage({
                type: 'switchModel',
                model
            });
        }
    });

    newSessionBtn.addEventListener('click', () => {
        const name = prompt('Enter session name:');
        if (name) {
            vscode.postMessage({
                type: 'createSession',
                name
            });
        }
    });

    settingsBtn.addEventListener('click', () => {
        vscode.postMessage({ type: 'openSettings' });
    });

    // Functions
    function sendMessage(): void {
        const content = messageInput.value.trim();
        if (!content) return;

        vscode.postMessage({
            type: 'sendMessage',
            content
        });

        messageInput.value = '';
        adjustTextareaHeight();
    }

    function updateMessages(messages: Message[]): void {
        messagesContainer.innerHTML = messages.map(formatMessage).join('');
        scrollToBottom();
        setupMessageActions();
    }

    function formatMessage(message: Message): string {
        const timestamp = new Date(message.timestamp).toLocaleTimeString();
        const provider = message.metadata?.provider ? `<span class="provider">${message.metadata.provider}</span>` : '';
        const model = message.metadata?.model ? `<span class="model">${message.metadata.model}</span>` : '';
        const tokens = message.metadata?.tokens ? `<span class="tokens">${message.metadata.tokens} tokens</span>` : '';
        
        const actions = message.role === 'user' ? `
            <div class="actions">
                <button class="icon-button edit-message" data-message-id="${message.id}">
                    <i class="codicon codicon-edit"></i>
                </button>
                <button class="icon-button delete-message" data-message-id="${message.id}">
                    <i class="codicon codicon-trash"></i>
                </button>
            </div>
        ` : '';

        return `
            <div class="message ${message.role}" data-message-id="${message.id}">
                <div class="content">${message.content}</div>
                <div class="metadata">
                    ${timestamp}
                    ${message.isEdited ? ' (edited)' : ''}
                    ${provider}
                    ${model}
                    ${tokens}
                </div>
                ${actions}
            </div>
        `;
    }

    function setupMessageActions(): void {
        document.querySelectorAll('.edit-message').forEach((button: Element) => {
            button.addEventListener('click', (e: Event) => {
                const target = e.currentTarget as HTMLButtonElement;
                const messageId = target.dataset.messageId;
                if (!messageId || !currentSession) return;

                const messageElement = document.querySelector(`.message[data-message-id="${messageId}"]`);
                if (!messageElement) return;

                const contentElement = messageElement.querySelector('.content');
                if (!contentElement) return;

                const content = contentElement.textContent || '';
                const newContent = prompt('Edit message:', content);
                if (newContent && newContent !== content) {
                    vscode.postMessage({
                        type: 'editMessage',
                        messageId,
                        sessionId: currentSession.id,
                        content: newContent
                    });
                }
            });
        });

        document.querySelectorAll('.delete-message').forEach((button: Element) => {
            button.addEventListener('click', (e: Event) => {
                const target = e.currentTarget as HTMLButtonElement;
                const messageId = target.dataset.messageId;
                if (!messageId || !currentSession) return;

                if (confirm('Delete this message?')) {
                    vscode.postMessage({
                        type: 'deleteMessage',
                        messageId,
                        sessionId: currentSession.id
                    });
                }
            });
        });
    }

    function handleSessionCreated(session: ChatSession): void {
        currentSession = session;
        updateSessionsList([session]);
        sessionSelect.value = session.id;
        updateMessages(session.messages);
    }

    function updateSessionsList(sessions: ChatSession[]): void {
        const options = sessions.map(session => `
            <option value="${session.id}"${currentSession?.id === session.id ? ' selected' : ''}>
                ${session.name}
            </option>
        `);
        
        sessionSelect.innerHTML = `
            <option value="">Select a session...</option>
            ${options.join('')}
        `;
    }

    function updateProvidersList(providers: { id: string; name: string; isActive: boolean }[]): void {
        const options = providers.map(provider => `
            <option value="${provider.id}"${provider.isActive ? ' selected' : ''}>
                ${provider.name}
            </option>
        `);

        providerSelect.innerHTML = `
            <option value="">Select a provider...</option>
            ${options.join('')}
        `;

        if (providers.find(p => p.isActive)) {
            currentProvider = providers.find(p => p.isActive)!.id;
        }
    }

    function updateModelsList(models: Provider[]): void {
        const options = models.flatMap(provider =>
            provider.models.map(model => `
                <option value="${model}"${currentSession?.settings?.model === model ? ' selected' : ''}>
                    ${model}
                </option>
            `)
        );

        modelSelect.innerHTML = `
            <option value="">Select a model...</option>
            ${options.join('')}
        `;
    }

    function updateSettings(settings: ChatSession['settings']): void {
        if (settings?.model) {
            modelSelect.value = settings.model;
        }
        if (settings?.provider) {
            providerSelect.value = settings.provider;
            currentProvider = settings.provider;
        }
    }

    function showLoading(): void {
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loading';
        messagesContainer.appendChild(loadingElement);
        scrollToBottom();
    }

    function hideLoading(): void {
        const loadingElement = messagesContainer.querySelector('.loading');
        if (loadingElement) {
            loadingElement.remove();
        }
    }

    function scrollToBottom(): void {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function adjustTextareaHeight(): void {
        messageInput.style.height = 'auto';
        messageInput.style.height = `${Math.min(messageInput.scrollHeight, 120)}px`;
    }
})(); 
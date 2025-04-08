declare const acquireVsCodeApi: () => any;

const vscode = acquireVsCodeApi();

// DOM Elements
const messageInputElement = document.getElementById('messageInput') as HTMLTextAreaElement;
const sendButtonElement = document.getElementById('sendButton') as HTMLButtonElement;
const messagesContainerElement = document.getElementById('messages') as HTMLDivElement;
const addModelButtonElement = document.getElementById('addModel') as HTMLButtonElement;
const includeImportsElement = document.getElementById('includeImports') as HTMLInputElement;
const includeTipsElement = document.getElementById('includeTips') as HTMLInputElement;
const includeTestsElement = document.getElementById('includeTests') as HTMLInputElement;
const messageTemplateElement = document.getElementById('message-template') as HTMLTemplateElement;
const codeBlockTemplateElement = document.getElementById('code-block-template') as HTMLTemplateElement;
const fileAttachmentTemplateElement = document.getElementById('file-attachment-template') as HTMLTemplateElement;
const attachFileButtonElement = document.getElementById('attachFile') as HTMLButtonElement;
const attachFolderButtonElement = document.getElementById('attachFolder') as HTMLButtonElement;
const chatModeSelectElement = document.getElementById('chatMode') as HTMLSelectElement;

if (!messageInputElement || !sendButtonElement || !messagesContainerElement || !addModelButtonElement || 
    !includeImportsElement || !includeTipsElement || !includeTestsElement ||
    !messageTemplateElement || !codeBlockTemplateElement || !fileAttachmentTemplateElement ||
    !attachFileButtonElement || !attachFolderButtonElement || !chatModeSelectElement) {
    throw new Error('Required DOM elements not found');
}

// Event Listeners
messageInputElement.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    } else if (e.key === 'Enter' && e.shiftKey) {
        // Allow multiline input with Shift+Enter
        const start = messageInputElement.selectionStart;
        const end = messageInputElement.selectionEnd;
        const value = messageInputElement.value;
        messageInputElement.value = value.substring(0, start) + '\n' + value.substring(end);
        messageInputElement.selectionStart = messageInputElement.selectionEnd = start + 1;
        e.preventDefault();
    }
});

sendButtonElement.addEventListener('click', sendMessage);
addModelButtonElement.addEventListener('click', () => {
    vscode.postMessage({ command: 'addModel' });
});

// Auto-resize textarea
messageInputElement.addEventListener('input', () => {
    messageInputElement.style.height = 'auto';
    messageInputElement.style.height = `${messageInputElement.scrollHeight}px`;
});

// File and folder attachment handling
let currentAttachments: Array<{type: 'file' | 'folder', path: string}> = [];

attachFileButtonElement?.addEventListener('click', () => {
    vscode.postMessage({ command: 'attachFile' });
});

attachFolderButtonElement?.addEventListener('click', () => {
    vscode.postMessage({ command: 'attachFolder' });
});

// Enhanced message sending with attachments and chat mode
function sendMessage() {
    const text = messageInputElement.value.trim();
    if (!text) return;

    const options = {
        includeImports: includeImportsElement.checked,
        includeTips: includeTipsElement.checked,
        includeTests: includeTestsElement.checked,
        chatMode: chatModeSelectElement.value
    };

    vscode.postMessage({
        command: 'sendMessage',
        text,
        options,
        attachments: currentAttachments
    });

    // Reset after sending
    messageInputElement.value = '';
    messageInputElement.style.height = 'auto';
    currentAttachments = [];
    updateAttachmentUI();
}

// Update attachment UI
function updateAttachmentUI() {
    const attachmentsContainer = document.querySelector('.current-attachments');
    if (!attachmentsContainer) return;

    attachmentsContainer.innerHTML = '';
    currentAttachments.forEach(attachment => {
        const element = document.createElement('div');
        element.className = 'attachment-item';
        element.innerHTML = `
            <i class="codicon codicon-${attachment.type === 'file' ? 'file-code' : 'folder'}"></i>
            <span>${attachment.path.split('/').pop()}</span>
            <button class="remove-attachment" data-path="${attachment.path}">
                <i class="codicon codicon-close"></i>
            </button>
        `;
        attachmentsContainer.appendChild(element);
    });
}

interface VSCodeMessage {
    command: string;
    message?: any;
    error?: string;
    path?: string;
}

// Handle messages from extension
window.addEventListener('message', (event: MessageEvent<VSCodeMessage>) => {
    const message = event.data;

    switch (message.command) {
        case 'addMessage':
            if (message.message) {
                addMessage(message.message);
            }
            break;
        case 'showLoading':
            showLoading();
            break;
        case 'hideLoading':
            hideLoading();
            break;
        case 'showError':
            if (message.error) {
                showError(message.error);
            }
            break;
        case 'fileAttached':
            if (message.path) {
                currentAttachments.push({ type: 'file', path: message.path });
                updateAttachmentUI();
            }
            break;
        case 'folderAttached':
            if (message.path) {
                currentAttachments.push({ type: 'folder', path: message.path });
                updateAttachmentUI();
            }
            break;
    }
});

interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    attachments?: Array<{
        type: 'file' | 'folder';
        path: string;
    }>;
}

function addMessage(message: ChatMessage) {
    const messageElement = messageTemplateElement.content.cloneNode(true) as DocumentFragment;
    const messageDiv = messageElement.querySelector('.message') as HTMLDivElement;
    const avatar = messageElement.querySelector('.avatar i') as HTMLElement;
    const content = messageElement.querySelector('.markdown-content') as HTMLDivElement;

    messageDiv.classList.add(message.role);
    avatar.classList.add(message.role === 'user' ? 'codicon-account' : 'codicon-hubot');

    // Process markdown and code blocks
    const formattedContent = formatMessage(message.content);
    content.innerHTML = formattedContent;

    // Add file attachments if any
    if (message.attachments && message.attachments.length > 0) {
        const attachmentsContainer = document.createElement('div');
        attachmentsContainer.className = 'attachments';

        message.attachments.forEach(attachment => {
            const attachmentElement = fileAttachmentTemplateElement.content.cloneNode(true) as DocumentFragment;
            const filename = attachmentElement.querySelector('.filename') as HTMLElement;
            const icon = attachmentElement.querySelector('.icon') as HTMLElement;

            filename.textContent = attachment.path.split('/').pop() || '';
            icon.classList.add(attachment.type === 'file' ? 'codicon-file-code' : 'codicon-folder');

            attachmentsContainer.appendChild(attachmentElement);
        });

        content.appendChild(attachmentsContainer);
    }

    messagesContainerElement.appendChild(messageElement);
    messagesContainerElement.scrollTop = messagesContainerElement.scrollHeight;
}

function formatMessage(content: string): string {
    // Basic markdown-like formatting
    return content
        .replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
            const codeBlock = codeBlockTemplateElement.content.cloneNode(true) as DocumentFragment;
            const pre = codeBlock.querySelector('pre') as HTMLPreElement;
            const codeElement = codeBlock.querySelector('code') as HTMLElement;
            
            if (lang) {
                codeElement.classList.add(`language-${lang}`);
            }
            
            codeElement.textContent = code.trim();
            
            const temp = document.createElement('div');
            temp.appendChild(codeBlock);
            return temp.innerHTML;
        })
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\*([^*]+)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>');
}

function showLoading() {
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message assistant loading';
    loadingDiv.innerHTML = `
        <div class="avatar">
            <i class="codicon codicon-loading codicon-modifier-spin"></i>
        </div>
        <div class="message-content">
            <div class="markdown-content">Thinking...</div>
        </div>
    `;
    messagesContainerElement.appendChild(loadingDiv);
    messagesContainerElement.scrollTop = messagesContainerElement.scrollHeight;
}

function hideLoading() {
    const loadingElement = messagesContainerElement.querySelector('.loading');
    if (loadingElement) {
        loadingElement.remove();
    }
}

function showError(error: string) {
    const errorDiv = document.createElement('div');
    errorDiv.className = 'message system error';
    errorDiv.innerHTML = `
        <div class="avatar">
            <i class="codicon codicon-error"></i>
        </div>
        <div class="message-content">
            <div class="markdown-content">${error}</div>
        </div>
    `;
    messagesContainerElement.appendChild(errorDiv);
    messagesContainerElement.scrollTop = messagesContainerElement.scrollHeight;
} 
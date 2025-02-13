// VS Code webview API
const vscode = acquireVsCodeApi();

// DOM Elements
const messagesContainer = document.getElementById('chatContainer');
const codePreview = document.getElementById('codePreview');
const userInput = document.getElementById('userInput');
const sendButton = document.getElementById('sendButton');
const newChatButton = document.getElementById('newChat');
const sessionList = document.getElementById('sessionList');

// State
let currentSession = null;
let sessions = [];

// Event Listeners
document.addEventListener('DOMContentLoaded', () => {
    // Auto scroll to bottom
    scrollToBottom();

    // Enter key handling
    userInput.addEventListener('keydown', handleKeyPress);
    
    // Button clicks
    sendButton.addEventListener('click', sendMessage);
    newChatButton.addEventListener('click', createNewSession);
});

// Message handling from extension
window.addEventListener('message', event => {
    const message = event.data;

    switch (message.command) {
        case 'updateSessions':
            sessions = message.sessions;
            currentSession = message.currentSession;
            updateSessionList();
            updateChatView();
            break;

        case 'updateCodePreview':
            updateCodePreview(message.preview);
            break;
    }
});

// Functions
function handleKeyPress(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
}

function sendMessage() {
    const text = userInput.value.trim();
    if (!text) return;

    vscode.postMessage({
        command: 'sendMessage',
        text: text
    });

    userInput.value = '';
    userInput.style.height = 'auto';
}

function createNewSession() {
    const title = 'New Chat';
    vscode.postMessage({
        command: 'createSession',
        title: title
    });
}

function selectSession(sessionId) {
    vscode.postMessage({
        command: 'selectSession',
        sessionId: sessionId
    });
}

function clearSession(sessionId, event) {
    event.stopPropagation();
    vscode.postMessage({
        command: 'clearSession',
        sessionId: sessionId
    });
}

function deleteSession(sessionId, event) {
    event.stopPropagation();
    vscode.postMessage({
        command: 'deleteSession',
        sessionId: sessionId
    });
}

function updateSessionList() {
    sessionList.innerHTML = sessions.map(session => `
        <div class="session-item ${session.id === currentSession?.id ? 'active' : ''}" 
             onclick="selectSession('${session.id}')">
            <span class="title">${session.title}</span>
            <div class="actions">
                <button onclick="clearSession('${session.id}', event)" title="Clear">
                    <i class="codicon codicon-clear-all"></i>
                </button>
                <button onclick="deleteSession('${session.id}', event)" title="Delete">
                    <i class="codicon codicon-trash"></i>
                </button>
            </div>
        </div>
    `).join('');
}

function updateChatView() {
    if (!currentSession) {
        messagesContainer.innerHTML = `
            <div class="empty-state">
                <h3>No active chat</h3>
                <p>Start a new chat or select an existing one</p>
            </div>
        `;
        return;
    }

    messagesContainer.innerHTML = currentSession.messages.map(msg => renderMessage(msg)).join('');
    scrollToBottom();
}

function renderMessage(message) {
    const isUser = message.role === 'user';
    const className = isUser ? 'user-message' : 'assistant-message';

    return `
        <div class="message ${className}">
            <div class="message-header">
                <span class="message-role">${isUser ? 'You' : 'Smile AI'}</span>
                <span class="message-time">${formatTime(message.timestamp)}</span>
            </div>
            <div class="message-content">
                ${marked.parse(message.content)}
            </div>
        </div>
    `;
}

function updateCodePreview(preview) {
    if (!preview) {
        codePreview.classList.remove('active');
        return;
    }

    codePreview.classList.add('active');
    codePreview.innerHTML = `
        <pre><code class="language-typescript">${escapeHtml(preview)}</code></pre>
        <div class="actions">
            <button onclick="applyChange()">Apply</button>
            <button onclick="revertChange()">Revert</button>
        </div>
    `;

    // Highlight code
    Prism.highlightAllUnder(codePreview);
}

function applyChange() {
    vscode.postMessage({
        command: 'applyChange'
    });
}

function revertChange() {
    vscode.postMessage({
        command: 'revertChange'
    });
}

// Utility functions
function scrollToBottom() {
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function formatTime(timestamp) {
    return new Date(timestamp).toLocaleTimeString();
}

function escapeHtml(unsafe) {
    return unsafe
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Auto-resize textarea
userInput.addEventListener('input', function() {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
}); 
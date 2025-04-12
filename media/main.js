// Create a self-executing function to avoid polluting the global namespace
(() => {
    "use strict";

    // Debug mode for verbose logging
    const DEBUG = true;
    function log(...args) {
        if (DEBUG) console.log("SMILE-AI:", ...args);
    }

    log("Starting initialization");

    // Get VS Code API
    let vscode;
    try {
        vscode = acquireVsCodeApi();
    } catch (e) {
        log("Error acquiring VS Code API:", e);
    }

    // Create direct function references
    function sendMessage(text) {
        if (!text || !vscode) return;
        
        log("Sending message:", text);
        
        // Disable input temporarily to prevent duplicate sends
        const userInput = document.getElementById('messageInput');
        const sendButton = document.getElementById('sendButton');
        
        if (userInput) userInput.disabled = true;
        if (sendButton) sendButton.disabled = true;
        
        // Don't add message locally anymore - let the extension handle it
        // to avoid duplication
        
        // Send to extension
        vscode.postMessage({
            command: 'sendMessage',
            text: text,
            options: {
                includeImports: true,
                includeTips: true,
                includeTests: true, 
                chatMode: 'chat'
            }
        });
        
        // Re-enable input after a short delay
        setTimeout(() => {
            if (userInput) {
                userInput.disabled = false;
                userInput.value = '';
                userInput.focus();
            }
            if (sendButton) sendButton.disabled = false;
        }, 500);
    }

    // Initialize when the document is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initializeWithDelay);
    } else {
        initializeWithDelay();
    }
    
    function initializeWithDelay() {
        // Use setTimeout to ensure the DOM is fully rendered
        setTimeout(() => {
            log("Initializing after delay");
            initializeUI();
        }, 500); // 500ms delay
    }
    
    function initializeUI() {
        // Find UI elements using multiple selector strategies
        const userInput = 
            document.getElementById('messageInput') || 
            document.querySelector('textarea[id="messageInput"]') ||
            document.querySelector('textarea[placeholder*="Ask"]');
        
        const sendButton = 
            document.getElementById('sendButton') || 
            document.querySelector('button[id="sendButton"]') ||
            document.querySelector('button.send-button') ||
            document.querySelector('.input-container button');
        
        log("Found elements:", {
            userInput: !!userInput,
            sendButton: !!sendButton
        });
        
        if (userInput) {
            // Add event listener for Enter key
            userInput.addEventListener('keydown', function(event) {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    const text = userInput.value.trim();
                    if (text) {
                        sendMessage(text);
                        userInput.value = '';
                    }
                }
            });
            
            log("Added keydown handler to userInput");
        }
        
        if (sendButton) {
            // Add event listener for click
            sendButton.addEventListener('click', function() {
                if (!userInput) return;
                
                const text = userInput.value.trim();
                if (text) {
                    sendMessage(text);
                    userInput.value = '';
                }
            });
            
            log("Added click handler to sendButton");
        }
        
        if (!userInput || !sendButton) {
            log("Could not find all required elements, retrying in 1 second");
            setTimeout(initializeUI, 1000);
        } else {
            log("Successfully initialized UI elements");
        }
    }

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        log("Received message from extension:", message.command);
        
        switch (message.command) {
            case 'addMessage':
                addMessageToUI(message.message);
                break;
            case 'showLoading':
                showLoadingUI();
                break;
            case 'hideLoading':
                hideLoadingUI();
                break;
            case 'showError':
                showErrorUI(message.error);
                break;
        }
    });
    
    function addMessageToUI(message) {
        log("Adding message to UI:", message);
        const messagesWrapper = document.getElementById('messages');
        if (!messagesWrapper) {
            log("Messages wrapper not found");
            return;
        }
        
        // Create message element
        const messageEl = document.createElement('div');
        messageEl.className = `message ${message.role}`;
        
        // Create avatar
        const avatarEl = document.createElement('div');
        avatarEl.className = 'avatar';
        const iconEl = document.createElement('i');
        iconEl.className = `codicon ${message.role === 'user' ? 'codicon-account' : 'codicon-hubot'}`;
        avatarEl.appendChild(iconEl);
        
        // Create content
        const contentEl = document.createElement('div');
        contentEl.className = 'message-content';
        const markdownEl = document.createElement('div');
        markdownEl.className = 'markdown-content';
        markdownEl.innerHTML = formatMessageContent(message.content);
        contentEl.appendChild(markdownEl);
        
        // Assemble message
        messageEl.appendChild(avatarEl);
        messageEl.appendChild(contentEl);
        
        // Add to messages
        messagesWrapper.appendChild(messageEl);
        
        // Scroll to bottom
        messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
    }
    
    function formatMessageContent(content) {
        // Basic formatting for code blocks and line breaks
        return content
            .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
            .replace(/`([^`]+)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    }
    
    function showLoadingUI() {
        const messagesWrapper = document.getElementById('messages');
        if (!messagesWrapper) return;
        
        // Remove any existing loading indicators
        hideLoadingUI();
        
        // Create loading indicator
        const loadingEl = document.createElement('div');
        loadingEl.className = 'message assistant loading';
        loadingEl.innerHTML = `
            <div class="avatar">
                <i class="codicon codicon-loading codicon-modifier-spin"></i>
            </div>
            <div class="message-content">
                <div class="markdown-content">Thinking...</div>
            </div>
        `;
        
        messagesWrapper.appendChild(loadingEl);
        messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
    }
    
    function hideLoadingUI() {
        const messagesWrapper = document.getElementById('messages');
        if (!messagesWrapper) return;
        
        const loadingEl = messagesWrapper.querySelector('.loading');
        if (loadingEl) {
            loadingEl.remove();
        }
    }
    
    function showErrorUI(error) {
        const messagesWrapper = document.getElementById('messages');
        if (!messagesWrapper) return;
        
        const errorEl = document.createElement('div');
        errorEl.className = 'message system error';
        errorEl.innerHTML = `
            <div class="avatar">
                <i class="codicon codicon-error"></i>
            </div>
            <div class="message-content">
                <div class="markdown-content">Error: ${error}</div>
            </div>
        `;
        
        messagesWrapper.appendChild(errorEl);
        messagesWrapper.scrollTop = messagesWrapper.scrollHeight;
    }
    
    log("Initialization script loaded");
})();
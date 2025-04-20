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

    // Store operations that are pending user approval
    let pendingOperations = [];

    // Document is ready
    document.addEventListener('DOMContentLoaded', () => {
        log("DOM fully loaded");
        
        // Set up the settings button event listener
        const settingsButton = document.querySelector('.settings-button button');
        if (settingsButton) {
            log("Settings button found, adding event listener");
            settingsButton.addEventListener('click', () => {
                log("Settings button clicked");
                vscode.postMessage({
                    command: 'addModel' // This is the command handled in the extension
                });
            });
        } else {
            log("Settings button not found in the DOM");
        }

        // Set up send button event listener
        const sendButton = document.querySelector('#send-button');
        const messageInput = document.querySelector('#message-input');

        if (sendButton && messageInput) {
            sendButton.addEventListener('click', () => {
                sendMessage();
            });

            messageInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    sendMessage();
                }
            });
        }
        
        // Initialize pending operations container
        const pendingOperationsContainer = document.querySelector('.pending-operations');
        if (pendingOperationsContainer) {
            log("Pending operations container found");
        } else {
            log("Pending operations container not found in the DOM");
        }
    });

    // Function to send message to extension
    function sendMessage() {
        const messageInput = document.querySelector('#message-input');
        const message = messageInput.value.trim();

        if (message) {
            vscode.postMessage({
                command: 'sendMessage',
                text: message
            });
            messageInput.value = '';

            // Don't add user message here since it will be added by the extension
            // addMessage('user', message);
            
            // No need to show loading here since it will be controlled by the extension
            // showLoading();
        }
    }

    // Function to add message to the chat
    function addMessage(role, content) {
        // Safety check for content
        if (content === undefined || content === null) {
            console.warn("Received null or undefined content in addMessage");
            content = "";
        }
        
        const chatContainer = document.querySelector('.chat-container .messages');
        
        const messageElement = document.createElement('div');
        messageElement.classList.add('message', role);
        
        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        const avatarIcon = document.createElement('i');
        avatarIcon.classList.add('codicon');
        
        // Set the appropriate icon based on role
        if (role === 'user') {
            avatarIcon.classList.add('codicon-account');
        } else if (role === 'assistant') {
            avatarIcon.classList.add('codicon-hubot');
        } else if (role === 'system') {
            avatarIcon.classList.add('codicon-info');
        } else if (role === 'error') {
            avatarIcon.classList.add('codicon-error');
        }
        
        avatar.appendChild(avatarIcon);
        
        const messageContent = document.createElement('div');
        messageContent.classList.add('message-content');
        
        // Add the message content safely
        try {
            // Process content for code blocks
            const processedContent = processCodeBlocks(content);
            
            // Create markdown content div
            const markdownContent = document.createElement('div');
            markdownContent.classList.add('markdown-content');
            markdownContent.innerHTML = processedContent;
            
            messageContent.appendChild(markdownContent);
        } catch (error) {
            console.error("Error processing message content:", error);
            messageContent.textContent = "Error displaying message content";
        }
        
        messageElement.appendChild(avatar);
        messageElement.appendChild(messageContent);
        
        chatContainer.appendChild(messageElement);
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Process code blocks in message content
    function processCodeBlocks(content) {
        // Check if content is null or undefined
        if (!content) {
            console.warn("Content is null or undefined in processCodeBlocks");
            return "";
        }
        
        // Ensure content is a string
        if (typeof content !== 'string') {
            console.warn("Content is not a string in processCodeBlocks:", content);
            return String(content || "");
        }
        
        // Replace code blocks with properly formatted HTML
        return content.replace(/```(\w+)?\n([\s\S]*?)```/g, (match, language, code) => {
            const languageClass = language ? `language-${language}` : '';
            return `<pre class="code-block ${languageClass}"><code>${escapeHtml(code)}</code></pre>`;
        });
    }

    // Escape HTML special characters
    function escapeHtml(unsafe) {
        return unsafe
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    // Show loading indicator
    function showLoading() {
        const chatContainer = document.querySelector('.chat-container .messages');
        
        const loadingElement = document.createElement('div');
        loadingElement.classList.add('message', 'assistant', 'loading');
        
        const avatar = document.createElement('div');
        avatar.classList.add('avatar');
        avatar.textContent = 'A';
        
        const loadingContent = document.createElement('div');
        loadingContent.classList.add('content');
        loadingContent.innerHTML = '<div class="loading-indicator"><span>.</span><span>.</span><span>.</span></div>';
        
        loadingElement.appendChild(avatar);
        loadingElement.appendChild(loadingContent);
        
        chatContainer.appendChild(loadingElement);
        
        // Scroll to bottom
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Hide loading indicator
    function hideLoading() {
        const loadingElement = document.querySelector('.message.loading');
        if (loadingElement) {
            loadingElement.remove();
        }
    }

    // Dosya adını tam yoldan ayıklayan yardımcı fonksiyon
    function getFilename(filePath) {
        if (!filePath) return '';
        // Windows veya unix yolu olabilir
        const parts = filePath.split(/[\\/]/);
        return parts[parts.length - 1] || '';
    }

    // Function to update the pending operations UI
    function updatePendingOperationsUI() {
        const pendingOperationsContainer = document.querySelector('.pending-operations');
        if (!pendingOperationsContainer) {
            console.error('Pending operations container not found in the DOM');
            return;
        }
        
        console.log('Updating pending operations UI with', pendingOperations.length, 'operations');
        
        pendingOperationsContainer.innerHTML = '';
        
        if (pendingOperations.length === 0) {
            pendingOperationsContainer.style.display = 'none';
            return;
        }

        pendingOperationsContainer.style.display = 'block';
        
        const header = document.createElement('div');
        header.classList.add('operations-header');
        header.innerHTML = `<h3>Pending File Operations (${pendingOperations.length})</h3>
                            <div class="operation-actions">
                                <button class="accept-all-button">Accept All</button>
                                <button class="reject-all-button">Reject All</button>
                            </div>`;
        pendingOperationsContainer.appendChild(header);
        
        // Add event listeners for accept/reject all buttons
        header.querySelector('.accept-all-button').addEventListener('click', () => {
            console.log('Accept all button clicked');
            vscode.postMessage({
                command: 'acceptAllOperations'
            });
        });
        
        header.querySelector('.reject-all-button').addEventListener('click', () => {
            console.log('Reject all button clicked');
            vscode.postMessage({
                command: 'rejectAllOperations'
            });
        });
        
        // Add each operation
        pendingOperations.forEach(operation => {
            console.log('Adding operation UI for:', operation);
            
            const operationElement = document.createElement('div');
            operationElement.classList.add('operation-item');
            operationElement.dataset.id = operation.id;
            
            const header = document.createElement('div');
            header.classList.add('operation-header');
            
            const opTypeText = operation.type === 'add' ? 'Create' : 
                             operation.type === 'update' ? 'Update' : 'Delete';
            
            const title = document.createElement('div');
            title.classList.add('operation-info');
            title.innerHTML = `
                <div class="operation-type">
                    <i class="codicon codicon-${operation.type === 'add' ? 'new-file' : 
                                                operation.type === 'update' ? 'edit' : 'trash'}"></i>
                    ${opTypeText}
                </div>
                <div class="operation-file">
                    <span class="file-name">${getFilename(operation.filePath)}</span>
                    <span class="file-path">(${operation.filePath})</span>
                </div>
            `;
            
            const actions = document.createElement('div');
            actions.classList.add('operation-actions');
            
            const acceptButton = document.createElement('button');
            acceptButton.classList.add('accept-button');
            acceptButton.innerHTML = '<i class="codicon codicon-check"></i> Accept';
            acceptButton.addEventListener('click', () => {
                console.log('Accept button clicked for operation:', operation.id);
                vscode.postMessage({
                    command: 'acceptOperation',
                    id: operation.id
                });
            });
            
            const rejectButton = document.createElement('button');
            rejectButton.classList.add('reject-button');
            rejectButton.innerHTML = '<i class="codicon codicon-discard"></i> Reject';
            rejectButton.addEventListener('click', () => {
                console.log('Reject button clicked for operation:', operation.id);
                vscode.postMessage({
                    command: 'rejectOperation',
                    id: operation.id
                });
            });
            
            actions.appendChild(acceptButton);
            actions.appendChild(rejectButton);
            
            header.appendChild(title);
            header.appendChild(actions);
            
            operationElement.appendChild(header);
            
            // Add operation description if available
            if (operation.description) {
                const description = document.createElement('div');
                description.classList.add('operation-description');
                description.textContent = operation.description;
                operationElement.appendChild(description);
            }
            
            // Add content preview based on operation type
            const contentContainer = document.createElement('div');
            contentContainer.classList.add('operation-content');
            
            // Add view diff button for update operations
            if (operation.type === 'update') {
                const viewDiffButton = document.createElement('button');
                viewDiffButton.classList.add('view-diff-button');
                viewDiffButton.innerHTML = '<i class="codicon codicon-diff"></i> View Changes';
                viewDiffButton.addEventListener('click', () => {
                    vscode.postMessage({
                        command: 'getOperationDiff',
                        id: operation.id
                    });
                    
                    // Toggle diff view
                    const diffContainer = operationElement.querySelector('.diff-container');
                    if (diffContainer) {
                        diffContainer.style.display = diffContainer.style.display === 'none' ? 'block' : 'none';
                        viewDiffButton.innerHTML = diffContainer.style.display === 'none' ? 
                            '<i class="codicon codicon-diff"></i> View Changes' : 
                            '<i class="codicon codicon-fold"></i> Hide Changes';
                    } else {
                        // Create placeholder for diff that will be filled by the diff response
                        const newDiffContainer = document.createElement('div');
                        newDiffContainer.classList.add('diff-container', 'loading');
                        newDiffContainer.innerHTML = 'Loading diff...';
                        contentContainer.appendChild(newDiffContainer);
                        viewDiffButton.innerHTML = '<i class="codicon codicon-fold"></i> Hide Changes';
                    }
                });
                contentContainer.appendChild(viewDiffButton);
            }
            
            operationElement.appendChild(contentContainer);
            pendingOperationsContainer.appendChild(operationElement);
        });
    }

    // Listen for messages from the extension
    window.addEventListener('message', event => {
        const message = event.data;
        if (!message || !message.command) {
            console.warn('Received invalid message from extension:', message);
            return;
        }
        
        console.log('Received message from extension:', message.command);
        
        try {
            switch (message.command) {
                case 'addMessage':
                    hideLoading();
                    if (message.message && typeof message.message === 'object') {
                        addMessage(
                            message.message.role || 'system', 
                            message.message.content || 'No content provided'
                        );
                    } else {
                        console.warn('Received invalid message object:', message.message);
                        addMessage('error', 'Error: Invalid message format received');
                    }
                    break;
                    
                case 'addMessages':
                    hideLoading();
                    if (Array.isArray(message.messages)) {
                        message.messages.forEach(msg => {
                            if (msg && typeof msg === 'object') {
                                addMessage(
                                    msg.role || 'system',
                                    msg.content || 'No content provided'
                                );
                            }
                        });
                    } else {
                        console.warn('Received invalid messages array:', message.messages);
                    }
                    break;
                    
                case 'showLoading':
                    showLoading();
                    break;
                    
                case 'hideLoading':
                    hideLoading();
                    break;
                    
                case 'showError':
                    hideLoading();
                    addMessage('error', `Error: ${message.error?.message || message.error || 'Unknown error'}`);
                    break;
                    
                case 'updatePendingOperations':
                    if (Array.isArray(message.operations)) {
                        console.log('Received pending operations:', message.operations);
                        pendingOperations = message.operations;
                        updatePendingOperationsUI();
                    } else {
                        console.warn('Received invalid operations data:', message.operations);
                    }
                    break;
                    
                case 'operationDiff':
                    if (message.id && message.diff) {
                        const operationElement = document.querySelector(`.operation-item[data-id="${message.id}"]`);
                        if (operationElement) {
                            const diffContainer = operationElement.querySelector('.diff-container');
                            if (diffContainer) {
                                diffContainer.classList.remove('loading');
                                diffContainer.innerHTML = message.diff;
                            }
                        }
                    }
                    break;
                    
                default:
                    console.log('Unhandled message command:', message.command);
            }
        } catch (error) {
            console.error('Error handling message:', error);
        }
    });

    log("Initialization script loaded");
})();
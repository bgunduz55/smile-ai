(() => {
    "use strict";
    
    const vscode = acquireVsCodeApi();
    const messageInput = document.getElementById("messageInput");
    const sendButton = document.getElementById("sendButton");
    const messagesContainer = document.getElementById("messages");
    const addModelButton = document.getElementById("addModel");
    const includeImportsCheckbox = document.getElementById("includeImports");
    const includeTipsCheckbox = document.getElementById("includeTips");
    const includeTestsCheckbox = document.getElementById("includeTests");
    const messageTemplate = document.getElementById("message-template");
    const codeBlockTemplate = document.getElementById("code-block-template");
    const fileAttachmentTemplate = document.getElementById("file-attachment-template");
    const attachFileButton = document.getElementById("attachFile");
    const attachFolderButton = document.getElementById("attachFolder");
    const chatModeSelect = document.getElementById("chatMode");
    const openChatButton = document.getElementById("openChat");
    const openComposerButton = document.getElementById("openComposer");
    const toolbarButtons = document.querySelectorAll(".toolbar-button[data-view]");

    // Check for essential elements
    if (!messageInput || !sendButton || !messagesContainer) {
        console.error("Essential DOM elements not found");
    }

    // Event Listeners
    messageInput?.addEventListener("keypress", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
    });

    sendButton?.addEventListener("click", handleSendMessage);

    addModelButton?.addEventListener("click", () => {
        vscode.postMessage({ command: "addModel" });
    });

    openChatButton?.addEventListener("click", () => {
        vscode.postMessage({ command: "openChat" });
    });

    openComposerButton?.addEventListener("click", () => {
        vscode.postMessage({ command: "openComposer" });
    });

    toolbarButtons.forEach((button) => {
        button.addEventListener("click", () => {
            const view = button.dataset.view;
            if (view) {
                toolbarButtons.forEach((btn) => btn.classList.remove("active"));
                button.classList.add("active");
                vscode.postMessage({ command: "switchView", view });
            }
        });
    });

    messageInput?.addEventListener("input", () => {
        messageInput.style.height = "auto";
        messageInput.style.height = `${messageInput.scrollHeight}px`;
    });

    let attachments = [];
    let isLoading = false;
    let hasError = false;
    let state = { messages: [] };

    // Restore previous state
    const previousState = vscode.getState();
    if (previousState) {
        state = previousState;
        state.messages.forEach(message => addMessageToUI(message));
    }

    function handleSendMessage() {
        const text = messageInput?.value.trim();
        if (text) {
            const options = {
                includeImports: includeImportsCheckbox?.checked ?? true,
                includeTips: includeTipsCheckbox?.checked ?? true,
                includeTests: includeTestsCheckbox?.checked ?? true,
                chatMode: chatModeSelect?.value ?? "chat"
            };

            vscode.postMessage({
                command: "sendMessage",
                text,
                options,
                attachments
            });

            if (messageInput) {
                messageInput.value = "";
                messageInput.style.height = "auto";
            }

            attachments = [];
            updateAttachments();
        }
    }

    function updateAttachments() {
        const attachmentsContainer = document.querySelector(".current-attachments");
        if (!attachmentsContainer) return;

        attachmentsContainer.innerHTML = "";
        attachments.forEach((attachment) => {
            const item = document.createElement("div");
            item.className = "attachment-item";
            item.innerHTML = `
                <i class="codicon codicon-${attachment.type === "file" ? "file-code" : "folder"}"></i>
                <span>${attachment.path.split("/").pop() || attachment.path.split("\\").pop()}</span>
                <button class="remove-attachment" data-path="${attachment.path}">
                    <i class="codicon codicon-close"></i>
                </button>
            `;

            const removeButton = item.querySelector(".remove-attachment");
            removeButton?.addEventListener("click", () => {
                const path = removeButton.dataset.path;
                if (path) {
                    attachments = attachments.filter(a => a.path !== path);
                    updateAttachments();
                }
            });

            attachmentsContainer.appendChild(item);
        });
    }

    attachFileButton?.addEventListener("click", () => {
        vscode.postMessage({ command: "attachFile" });
    });

    attachFolderButton?.addEventListener("click", () => {
        vscode.postMessage({ command: "attachFolder" });
    });

    function formatMarkdown(content) {
        return content
            .replace(/```(\w*)\n([\s\S]*?)```/g, (match, lang, code) => {
                if (!codeBlockTemplate) {
                    return `<pre><code>${code}</code></pre>`;
                }

                const template = codeBlockTemplate.content.cloneNode(true);
                const codeElement = template.querySelector("code");

                if (codeElement) {
                    if (lang) {
                        codeElement.classList.add(`language-${lang}`);
                    }
                    codeElement.textContent = code.trim();
                }

                const wrapper = document.createElement("div");
                wrapper.appendChild(template);
                return wrapper.innerHTML;
            })
            .replace(/`([^`]+)`/g, "<code>$1</code>")
            .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
            .replace(/\*([^*]+)\*/g, "<em>$1</em>")
            .replace(/\n/g, "<br>");
    }

    function addMessageToUI(message) {
        if (!messageTemplate || !messagesContainer) return;

        const template = messageTemplate.content.cloneNode(true);
        const messageElement = template.querySelector(".message");
        const avatarIcon = template.querySelector(".avatar i");
        const contentElement = template.querySelector(".markdown-content");

        if (!messageElement || !avatarIcon || !contentElement) return;

        messageElement.classList.add(message.role);
        avatarIcon.classList.add(message.role === "user" ? "codicon-account" : "codicon-hubot");

        const formattedContent = formatMarkdown(message.content);
        contentElement.innerHTML = formattedContent;

        if (message.attachments && message.attachments.length > 0 && fileAttachmentTemplate) {
            const attachmentsContainer = document.createElement("div");
            attachmentsContainer.className = "attachments";

            message.attachments.forEach((attachment) => {
                const attachmentTemplate = fileAttachmentTemplate.content.cloneNode(true);
                const filename = attachmentTemplate.querySelector(".filename");
                const icon = attachmentTemplate.querySelector(".icon");

                if (filename && icon) {
                    const parts = attachment.path.split(/[\/\\]/);
                    filename.textContent = parts[parts.length - 1] || "";
                    icon.classList.add(attachment.type === "file" ? "codicon-file-code" : "codicon-folder");
                }

                attachmentsContainer.appendChild(attachmentTemplate);
            });

            contentElement.appendChild(attachmentsContainer);
        }

        messagesContainer.appendChild(template);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;

        // Add copy button functionality
        messagesContainer.querySelectorAll(".code-block .copy-button").forEach((button) => {
            button.addEventListener("click", (e) => {
                const codeBlock = e.target.closest(".code-block");
                const code = codeBlock?.querySelector("code")?.textContent;

                if (code) {
                    navigator.clipboard.writeText(code).then(() => {
                        const copyButton = e.target.closest(".copy-button");
                        if (copyButton) {
                            const originalContent = copyButton.innerHTML;
                            copyButton.innerHTML = '<i class="codicon codicon-check"></i>';
                            setTimeout(() => {
                                copyButton.innerHTML = originalContent;
                            }, 1000);
                        }
                    });
                }
            });
        });
    }

    function showLoading() {
        if (!messagesContainer) return;

        const loadingMessage = document.createElement("div");
        loadingMessage.className = "message assistant loading";
        loadingMessage.innerHTML = `
            <div class="avatar">
                <i class="codicon codicon-loading codicon-modifier-spin"></i>
            </div>
            <div class="message-content">
                <div class="markdown-content">Thinking...</div>
            </div>
        `;

        messagesContainer.appendChild(loadingMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    function hideLoading() {
        if (!messagesContainer) return;

        const loadingElement = messagesContainer.querySelector(".loading");
        if (loadingElement) {
            loadingElement.remove();
        }
    }

    function showError(error) {
        if (!messagesContainer) return;

        const errorMessage = document.createElement("div");
        errorMessage.className = "message system error";
        errorMessage.innerHTML = `
            <div class="avatar">
                <i class="codicon codicon-error"></i>
            </div>
            <div class="message-content">
                <div class="markdown-content">Error: ${error}</div>
            </div>
        `;

        messagesContainer.appendChild(errorMessage);
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }

    // Handle messages from extension
    window.addEventListener("message", (event) => {
        const message = event.data;
        console.log("Received message from extension:", message);

        switch (message.command) {
            case "addMessage":
                if (message.message) {
                    console.log("Adding message to UI:", message.message);
                    addMessageToUI(message.message);
                }
                break;

            case "showLoading":
                console.log("Showing loading state");
                showLoading();
                break;

            case "hideLoading":
                console.log("Hiding loading state");
                hideLoading();
                break;

            case "showError":
                if (message.error) {
                    console.log("Showing error:", message.error);
                    showError(message.error);
                }
                break;

            case "fileAttached":
                if (message.path) {
                    console.log("File attached:", message.path);
                    attachments.push({ type: "file", path: message.path });
                    updateAttachments();
                }
                break;

            case "folderAttached":
                if (message.path) {
                    console.log("Folder attached:", message.path);
                    attachments.push({ type: "folder", path: message.path });
                    updateAttachments();
                }
                break;

            case "updateModels":
                if (message.models) {
                    console.log("Updating models list:", message.models);
                }
                break;
        }
    });
})();
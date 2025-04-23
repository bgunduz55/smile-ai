# Smile AI - Agent-based Coding Assistant for VSCode

Smile AI is an intelligent coding assistant for VSCode that uses agent-based architecture to help you with complex coding tasks. The assistant can create files, modify code, and understand the structure of your codebase - all with the power of AI.

## Features

### 🧠 Agent-based Architecture

Smile AI uses a sophisticated agent system to:

- **Plan complex tasks**: Break down your request into subtasks
- **Work with context**: Understand your codebase structure
- **Create and modify files**: Automatically implement code changes
- **Handle errors**: Self-recover from failures with alternative approaches

### 🚀 Multiple AI Provider Support

- **Local models**: Ollama, LM Studio, LocalAI, Deepseek, Qwen
- **Cloud models**: OpenAI, Anthropic Claude

### 📝 Code Operations

- **Create new files** with proper directory structure
- **Update existing files** with intelligent diff handling
- **Multi-file operations** handled as atomic transactions
- **Error recovery** with automatic retries and alternative approaches

### 🔍 Context-Aware Assistance

- **Codebase indexing** for relevant context
- **RAG integration** for semantic search
- **File and folder attachments** for specific context
- **Selection-based assistance** for targeted help

## Getting Started

1. Install the extension from the VSCode marketplace
2. Configure your preferred AI provider in the settings
3. Start using the commands to interact with Smile AI:
   - `Smile AI: Start Chat` - Open the chat panel
   - `Smile AI: Run Agent Command` - Execute a full agent task
   - `Smile AI: Run Agent with Selection` - Use selected code as context

## How It Works: Agent System

Smile AI's agent system follows this workflow:

1. **Planning**: When you submit a request, the agent first analyzes it and creates a detailed plan with subtasks
2. **Context Gathering**: The agent collects necessary context from your codebase
3. **Task Execution**: Each subtask is executed in sequence, with dependencies tracked
4. **File Operations**: The agent creates or modifies files automatically
5. **Error Recovery**: If a task fails, the agent attempts to recover automatically

### Example Agent Request

```
Create a React component that displays a list of users with search functionality
```

The agent will:
1. Plan the necessary files (component, styles, tests)
2. Create each file with complete implementations
3. Show you a summary of the changes

## Configuration

### Local Models

To use local models like Ollama:

```json
{
  "smile-ai.provider": "ollama",
  "smile-ai.endpoint": "http://localhost:11434",
  "smile-ai.model": "codellama"
}
```

### Cloud Models

For cloud providers like OpenAI:

```json
{
  "smile-ai.provider": "openai",
  "smile-ai.apiKey": "your-api-key",
  "smile-ai.model": "gpt-4-turbo"
}
```

## Developing & Contributing

This extension is written in TypeScript and follows a clean architecture pattern:

- `src/agent`: Agent system components
- `src/ai-engine`: AI provider integrations  
- `src/utils`: Utility functions and helpers
- `src/indexing`: Codebase indexing components
- `src/views`: UI components and panels

To contribute:
1. Clone the repository
2. Run `npm install`
3. Make your changes
4. Run `npm run compile` to build
5. Use F5 in VSCode to run the extension in development mode

## Implementation Status

As of the latest update, we have completed the implementation of our agent-based architecture:

✅ **Enhanced Agent System**
- TaskPlanning with decomposition and dependency management
- Context gathering for relevant files
- Sequential execution with error handling
- Comprehensive summary generation

✅ **File Operation Integration**
- Reliable file creation and modification
- Tracking of operations for potential rollback
- Multiple format support for different AI responses
- Error recovery with automatic retries

✅ **VSCode Integration**
- Command palette integration
- Status bar updates and progress reporting
- Selection-based contextual commands
- Output channel for detailed logs

The agent system now works like Cursor, able to:
- Analyze user requests and break them down into manageable tasks
- Create and modify files in your workspace based on the plan
- Recover from failures with intelligent retry mechanisms
- Provide detailed summaries of actions taken

## License

MIT


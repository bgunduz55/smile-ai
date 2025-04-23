# Agent System Architecture

## Overview

The Smile AI agent system is a sophisticated framework designed to handle complex coding tasks autonomously. Unlike simple chat-based systems, the agent can plan, execute, and recover from errors when processing user requests.

## Core Components

### AgentEngine

The `AgentEngine` class is the central controller for the agent system. It orchestrates:

1. Task planning and breakdown
2. Context gathering
3. Sequential task execution
4. Error recovery
5. Status reporting

### TaskPlan

A `TaskPlan` represents a structured approach to solving a user's request:

- **Main goal**: Overall objective
- **Task breakdown**: List of subtasks with dependencies
- **Context required**: Files and information needed
- **Risks and considerations**: Potential issues

### File Operations Integration

The agent system works closely with the `FileOperationManager` to:

- Create new files
- Update existing files
- Track changes for potential rollback
- Group related file operations

## Workflow

### 1. Planning Phase

When a user submits a request, the system:

1. Analyzes the request
2. Breaks it down into logical subtasks
3. Identifies dependencies between subtasks
4. Prioritizes tasks based on complexity and importance

```typescript
// Example of a task plan
{
  "mainGoal": "Create a React component for user profiles",
  "taskBreakdown": [
    {
      "id": "task1",
      "type": "FILE_CREATION",
      "description": "Create ProfileComponent.tsx file",
      "priority": "HIGH",
      "dependencies": []
    },
    {
      "id": "task2",
      "type": "FILE_CREATION",
      "description": "Create ProfileComponent.css file",
      "priority": "MEDIUM",
      "dependencies": ["task1"]
    }
  ]
}
```

### 2. Context Gathering

The system intelligently gathers relevant context:

- Files mentioned in the request
- Related files based on the task
- Project structure information
- Configuration files

### 3. Task Execution

Tasks are executed in the proper order, respecting dependencies:

1. Check if dependencies are met
2. Create a detailed prompt for the AI
3. Process the AI response
4. Extract file operations
5. Apply changes to the workspace
6. Track results

### 4. Error Recovery

If a task fails, the system can:

1. Analyze the error
2. Generate a recovery plan
3. Retry with modified approach
4. Provide detailed error information

## Integration Points

### AI Engine

The agent system interacts with the AI Engine through:

- `processAgentMessage`: Sends requests to the AI
- `processFileOperations`: Extracts file operations from responses

### File Operation Manager

The agent leverages the File Operation Manager to:

- Create file operations
- Track pending changes
- Apply operations automatically
- Group related operations

### VSCode Integration

The agent integrates with VSCode via:

- Commands for agent execution
- Progress indicators
- Output channel for logs
- Status bar items

## Technical Design Decisions

### Task Decomposition

We chose to decompose tasks rather than sending a single large request because:

1. It allows for better error isolation
2. Reduces complexity of each AI request
3. Enables more precise context gathering
4. Creates a more reliable execution flow

### File Operation Handling

File operations are processed in a structured way:

1. Extract operations from AI response
2. Create appropriate operations (add, update, delete)
3. Apply operations immediately but track them
4. Allow for potential rollback

### Error Management

The multi-layered error handling ensures reliability:

1. Request-level error catching
2. Task-level error recovery
3. File operation alternative approaches
4. Intelligent retries with modified context

## Future Enhancements

Planned improvements to the agent system:

1. **Parallel task execution**: Execute independent tasks simultaneously
2. **Interactive planning**: Allow users to modify task plans before execution
3. **Learning from feedback**: Improve planning based on success/failure history
4. **Enhanced context awareness**: Better understanding of project architecture
5. **Advanced recovery strategies**: More sophisticated error handling

## Usage Examples

### Basic Command

```
Smile AI: Run Agent Command
> Create a React component for user authentication with login and registration forms
```

### Selection-Based Command

```
Smile AI: Run Agent with Selection
> Refactor this code to use TypeScript generics
```

The agent will process the selected code and apply the refactoring using TypeScript generics. 
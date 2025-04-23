import * as vscode from 'vscode';
import { AIEngine } from '../ai-engine/AIEngine';
import { Task, TaskStatus } from './types';
import { TaskManager } from './TaskManager';
import { CodebaseIndexer } from '../indexing/CodebaseIndexer';
import * as path from 'path';

/**
 * Core engine for handling agent-based operations
 * Responsible for:
 * 1. Task planning and decomposition
 * 2. Executing agent tasks in sequence
 * 3. Managing context between operations
 * 4. Handling errors and retries
 */
export class AgentEngine {
    private static instance: AgentEngine;
    private readonly aiEngine: AIEngine;
    private readonly codebaseIndexer: CodebaseIndexer;
    private readonly context: AgentContext;
    private isExecuting: boolean = false;

    private constructor(aiEngine: AIEngine, codebaseIndexer: CodebaseIndexer) {
        this.aiEngine = aiEngine;
        this.codebaseIndexer = codebaseIndexer;
        this.context = {
            currentTask: undefined,
            taskQueue: [],
            taskHistory: [],
            metadata: {},
            artifacts: {}
        };
    }

    public static getInstance(
        aiEngine: AIEngine, 
        _taskManager: TaskManager, // Renamed with underscore to indicate unused
        codebaseIndexer: CodebaseIndexer
    ): AgentEngine {
        if (!AgentEngine.instance) {
            AgentEngine.instance = new AgentEngine(aiEngine, codebaseIndexer);
        }
        return AgentEngine.instance;
    }

    /**
     * Processes a user request through the agent system
     * 1. Plans the task
     * 2. Decomposes into subtasks
     * 3. Executes each subtask
     * 4. Provides a summary
     */
    public async processRequest(request: string): Promise<string> {
        try {
            console.log('Agent processing request:', request);
            
            // Create a task plan
            const plan = await this.createTaskPlan(request);
            console.log('Task plan created:', plan);
            
            // Process the tasks
            const result = await this.executePlan(plan);
            
            return result;
        } catch (error) {
            console.error('Error in agent processing:', error);
            return `I encountered an error while processing your request: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    /**
     * Creates a detailed task plan by:
     * 1. Analyzing the request
     * 2. Breaking it down into subtasks
     * 3. Prioritizing and ordering subtasks
     */
    private async createTaskPlan(request: string): Promise<TaskPlan> {
        const planningPrompt = `
        I need to plan a coding task based on the following request. Please analyze it and create a detailed plan:
        
        USER REQUEST:
        ${request}
        
        Your response should be in this JSON format:
        {
            "mainGoal": "Brief description of the overall goal",
            "taskBreakdown": [
                {
                    "id": "task1",
                    "type": "CODE_MODIFICATION | FILE_CREATION | CODE_ANALYSIS | REFACTORING",
                    "description": "Detailed description of what needs to be done",
                    "priority": "HIGH | MEDIUM | LOW",
                    "dependencies": [],
                    "estimatedComplexity": "HIGH | MEDIUM | LOW"
                }
            ],
            "contextRequired": [
                "List of files or information needed to complete these tasks"
            ],
            "risksAndConsiderations": [
                "Potential issues to watch for"
            ]
        }
        
        Think step by step about what files need to be created or modified, and create logical dependencies between tasks.
        `;
        
        const planResponse = await this.aiEngine.processAgentMessage(planningPrompt, {
            options: {
                temperature: 0.2 // Lower temperature for planning
            }
        });
        
        // Extract JSON from the response
        const jsonMatch = planResponse.match(/```json\n([\s\S]*?)\n```/) || 
                          planResponse.match(/{[\s\S]*}/);
        
        if (!jsonMatch) {
            throw new Error('Failed to parse task plan from AI response');
        }
        
        try {
            const plan = JSON.parse(jsonMatch[1] || jsonMatch[0]);
            return this.validateAndEnhancePlan(plan, request);
        } catch (error) {
            console.error('Error parsing task plan:', error);
            throw new Error('Failed to parse the task plan. The AI response was not in valid JSON format.');
        }
    }
    
    /**
     * Validates and enhances the task plan with additional metadata
     */
    private validateAndEnhancePlan(plan: any, originalRequest: string): TaskPlan {
        if (!plan.mainGoal || !plan.taskBreakdown || !Array.isArray(plan.taskBreakdown)) {
            throw new Error('Invalid task plan structure');
        }
        
        // Add timestamps and IDs
        const enhancedPlan: TaskPlan = {
            id: `plan-${Date.now()}`,
            mainGoal: plan.mainGoal,
            originalRequest,
            taskBreakdown: plan.taskBreakdown.map((task: any, index: number) => ({
                ...task,
                id: task.id || `task-${index + 1}`,
                status: TaskStatus.PENDING,
                startTime: null,
                endTime: null
            })),
            contextRequired: plan.contextRequired || [],
            risksAndConsiderations: plan.risksAndConsiderations || [],
            created: Date.now(),
            status: 'PENDING',
            subtaskResults: {}
        };
        
        return enhancedPlan;
    }
    
    /**
     * Executes a task plan by:
     * 1. Gathering necessary context
     * 2. Processing each subtask in the correct order
     * 3. Handling dependencies between tasks
     * 4. Retrying failed tasks when appropriate
     */
    private async executePlan(plan: TaskPlan): Promise<string> {
        if (this.isExecuting) {
            return 'Another task is already being executed. Please wait until it completes.';
        }
        
        this.isExecuting = true;
        
        try {
            // Mark the plan as in progress
            plan.status = 'IN_PROGRESS';
            
            // Gather context for all tasks
            await this.gatherPlanContext(plan);
            
            // Sort tasks by dependencies and priority
            const sortedTasks = this.sortTasksByDependencies(plan.taskBreakdown);
            
            // Execute each task in order
            for (const task of sortedTasks) {
                // Skip already completed tasks
                if (task.status === TaskStatus.COMPLETED) {
                    continue;
                }
                
                // Check if dependencies are met
                const dependenciesMet = this.checkDependencies(task, plan);
                if (!dependenciesMet) {
                    task.status = TaskStatus.FAILED;
                    plan.subtaskResults[task.id] = {
                        success: false,
                        message: 'Dependencies not met'
                    };
                    continue;
                }
                
                // Execute the task
                task.status = TaskStatus.IN_PROGRESS;
                task.startTime = Date.now();
                
                try {
                    const result = await this.executeTask(task, plan);
                    task.status = result.success ? TaskStatus.COMPLETED : TaskStatus.FAILED;
                    plan.subtaskResults[task.id] = result;
                } catch (error) {
                    console.error(`Error executing task ${task.id}:`, error);
                    task.status = TaskStatus.FAILED;
                    plan.subtaskResults[task.id] = {
                        success: false,
                        message: `Error: ${error instanceof Error ? error.message : String(error)}`
                    };
                    
                    // Try to recover if task is critical
                    if (task.priority === 'HIGH') {
                        const recovered = await this.recoverTask(task, error, plan);
                        if (recovered) {
                            task.status = TaskStatus.COMPLETED;
                            plan.subtaskResults[task.id].success = true;
                            plan.subtaskResults[task.id].message = 'Recovered after failure';
                        }
                    }
                }
                
                task.endTime = Date.now();
            }
            
            // Check if plan completed successfully
            const allTasksCompleted = sortedTasks.every(task => 
                task.status === TaskStatus.COMPLETED);
            
            plan.status = allTasksCompleted ? 'COMPLETED' : 'PARTIALLY_COMPLETED';
            
            // Generate a summary
            return this.generatePlanSummary(plan);
        } finally {
            this.isExecuting = false;
        }
    }
    
    /**
     * Gathers context information needed for the plan execution
     */
    private async gatherPlanContext(plan: TaskPlan): Promise<void> {
        const contextFiles = plan.contextRequired;
        const context: Record<string, any> = {};
        
        // Get workspace root
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace folder found');
        }
        
        // Load content for each required context file
        for (const filePattern of contextFiles) {
            if (filePattern.includes('*')) {
                // Handle glob patterns
                const files = await this.codebaseIndexer.findFiles(filePattern);
                for (const file of files) {
                    const relativePath = path.relative(workspaceRoot, file.fsPath);
                    try {
                        const content = await vscode.workspace.fs.readFile(file);
                        context[relativePath] = content.toString();
                    } catch (error) {
                        console.warn(`Failed to read file ${relativePath}:`, error);
                    }
                }
            } else {
                // Handle direct file paths
                try {
                    const filePath = path.isAbsolute(filePattern) 
                        ? filePattern 
                        : path.join(workspaceRoot, filePattern);
                    
                    const fileUri = vscode.Uri.file(filePath);
                    const content = await vscode.workspace.fs.readFile(fileUri);
                    const relativePath = path.relative(workspaceRoot, filePath);
                    context[relativePath] = content.toString();
                } catch (error) {
                    console.warn(`Failed to read file ${filePattern}:`, error);
                }
            }
        }
        
        // Store the context in the plan
        this.context.metadata.planContext = context;
    }
    
    /**
     * Sort tasks by dependencies to ensure proper execution order
     */
    private sortTasksByDependencies(tasks: PlanTask[]): PlanTask[] {
        // Create a copy to avoid modifying the original
        const result: PlanTask[] = [];
        const pending = [...tasks];
        
        // Helper to check if a task's dependencies are in the result
        const dependenciesSatisfied = (task: PlanTask): boolean => {
            if (!task.dependencies || task.dependencies.length === 0) {
                return true;
            }
            return task.dependencies.every(depId => 
                result.some(t => t.id === depId));
        };
        
        // Keep going until all tasks are sorted or we can't progress
        while (pending.length > 0) {
            const initialLength = pending.length;
            
            // Find tasks with satisfied dependencies
            for (let i = 0; i < pending.length; i++) {
                if (dependenciesSatisfied(pending[i])) {
                    result.push(pending[i]);
                    pending.splice(i, 1);
                    i--; // Adjust index after removal
                }
            }
            
            // If we couldn't add any tasks, we have a circular dependency
            if (pending.length === initialLength && pending.length > 0) {
                console.warn('Circular dependencies detected in tasks');
                
                // Just add the highest priority task
                pending.sort((a, b) => {
                    const priorityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
                    const aPriority = priorityOrder[a.priority as keyof typeof priorityOrder] || 1;
                    const bPriority = priorityOrder[b.priority as keyof typeof priorityOrder] || 1;
                    return aPriority - bPriority;
                });
                
                result.push(pending[0]);
                pending.splice(0, 1);
            }
        }
        
        return result;
    }
    
    /**
     * Check if all dependencies for a task are completed
     */
    private checkDependencies(task: PlanTask, plan: TaskPlan): boolean {
        if (!task.dependencies || task.dependencies.length === 0) {
            return true;
        }
        
        return task.dependencies.every(depId => {
            const dependency = plan.taskBreakdown.find(t => t.id === depId);
            return dependency && dependency.status === TaskStatus.COMPLETED;
        });
    }
    
    /**
     * Execute a specific task
     */
    private async executeTask(task: PlanTask, plan: TaskPlan): Promise<SubtaskResult> {
        console.log(`Executing task ${task.id}: ${task.description}`);
        
        // Create the task execution prompt
        const prompt = await this.createTaskPrompt(task, plan);
        
        // Send to AI Engine for processing
        const response = await this.aiEngine.processAgentMessage(prompt, {
            options: {
                temperature: 0.4, // Balance between creativity and reliability
                maxTokens: 2048 // Ensure enough tokens for detailed responses
            }
        });
        
        // Extract file operations
        const fileOperationsResult = await this.handleFileOperations(response, task);
        
        return {
            success: true,
            message: 'Task completed successfully',
            fileOperations: fileOperationsResult.operationIds,
            outputs: response,
            artifacts: fileOperationsResult.filePaths
        };
    }
    
    /**
     * Creates a detailed prompt for executing a specific task
     */
    private async createTaskPrompt(task: PlanTask, plan: TaskPlan): Promise<string> {
        // Get workspace root
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
        if (!workspaceRoot) {
            throw new Error('No workspace folder found');
        }
        
        // Get results from completed dependent tasks
        const dependencyResults: Record<string, any> = {};
        if (task.dependencies) {
            for (const depId of task.dependencies) {
                dependencyResults[depId] = plan.subtaskResults[depId];
            }
        }
        
        // Build context information
        let contextInfo = '';
        const planContext = this.context.metadata.planContext || {};
        
        for (const [filePath, content] of Object.entries(planContext)) {
            contextInfo += `\n### File: ${filePath}\n\`\`\`\n${content}\n\`\`\`\n`;
        }
        
        // Create the prompt
        return `
        I need you to execute the following task as part of a larger plan:
        
        PLAN OVERVIEW:
        ${plan.mainGoal}
        
        CURRENT TASK:
        ID: ${task.id}
        Type: ${task.type}
        Description: ${task.description}
        Priority: ${task.priority}
        
        ${task.dependencies && task.dependencies.length > 0 ? `
        DEPENDENT TASKS RESULTS:
        ${JSON.stringify(dependencyResults, null, 2)}
        ` : ''}
        
        CONTEXT INFORMATION:
        ${contextInfo}
        
        INSTRUCTIONS:
        1. Analyze the task and context carefully
        2. For file creation or modification, provide complete code in markdown code blocks with file paths
        3. Each file should be in its own code block in this format:
        
        \`\`\`typescript
        path/to/file.ts
        // Complete file content here
        \`\`\`
        
        4. Remember to follow project's code style and architecture
        5. If you encounter any issues, explain them and propose solutions
        
        IMPORTANT NOTES:
        - Create complete implementations, not stubs
        - Include all necessary imports
        - Follow TypeScript best practices
        - Ensure compatibility with VSCode extension API
        - Files will be automatically created/updated based on your response
        
        Think step-by-step about the implementation.
        `;
    }
    
    /**
     * Try to recover from a failed task
     */
    private async recoverTask(task: PlanTask, error: any, plan: TaskPlan): Promise<boolean> {
        console.log(`Attempting to recover failed task ${task.id}`);
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        
        const recoveryPrompt = `
        A task has failed and needs recovery. Here are the details:
        
        TASK:
        ID: ${task.id}
        Type: ${task.type}
        Description: ${task.description}
        
        ERROR:
        ${errorMessage}
        
        PLAN CONTEXT:
        ${plan.mainGoal}
        
        Please analyze what went wrong and provide a corrected implementation that avoids this error.
        Think about:
        1. What caused the error
        2. How to fix it
        3. A complete implementation that works around the issue
        
        Provide your solution in code blocks with file paths as the first line.
        `;
        
        const recoveryResponse = await this.aiEngine.processAgentMessage(recoveryPrompt, {
            options: {
                temperature: 0.2, // Lower temperature for recovery
                maxTokens: 2048
            }
        });
        
        // Extract file operations from recovery response
        const recoveryResult = await this.handleFileOperations(recoveryResponse, task);
        
        // Check if recovery was successful
        return recoveryResult.operationIds.length > 0;
    }
    
    /**
     * Extract and process file operations from AI response
     */
    private async handleFileOperations(response: string, task: PlanTask): Promise<{
        operationIds: string[];
        filePaths: string[];
    }> {
        // Use the AIEngine's public method to process file operations
        const result = await this.aiEngine.processFileOperations(response);
        
        if (!result.success) {
            console.warn(`File operations processing failed for task ${task.id}`);
        }
        
        return {
            operationIds: result.operationIds || [],
            filePaths: result.filePaths || []
        };
    }
    
    /**
     * Generate a summary of the plan execution
     */
    private generatePlanSummary(plan: TaskPlan): string {
        // Count completed and failed tasks
        const totalTasks = plan.taskBreakdown.length;
        const completedTasks = plan.taskBreakdown.filter(t => t.status === TaskStatus.COMPLETED).length;
        const failedTasks = plan.taskBreakdown.filter(t => t.status === TaskStatus.FAILED).length;
        
        // Calculate success rate
        const successRate = Math.round((completedTasks / totalTasks) * 100);
        
        // Generate a summary
        let summary = `Plan execution ${plan.status === 'COMPLETED' ? 'completed successfully' : 'partially completed'}.\n`;
        summary += `${completedTasks}/${totalTasks} tasks completed (${successRate}% success rate).\n\n`;
        
        // List created/modified files
        const modifiedFiles: string[] = [];
        for (const result of Object.values(plan.subtaskResults)) {
            if (result.artifacts) {
                modifiedFiles.push(...result.artifacts);
            }
        }
        
        if (modifiedFiles.length > 0) {
            summary += `Modified files:\n`;
            modifiedFiles.forEach(file => {
                summary += `- ${file}\n`;
            });
        }
        
        // List failed tasks
        if (failedTasks > 0) {
            summary += `\nFailed tasks:\n`;
            plan.taskBreakdown
                .filter(t => t.status === TaskStatus.FAILED)
                .forEach(task => {
                    const result = plan.subtaskResults[task.id];
                    summary += `- ${task.description}: ${result?.message || 'Unknown error'}\n`;
                });
        }
        
        return summary;
    }
}

/**
 * Task plan structure for agent operations
 */
export interface TaskPlan {
    id: string;
    mainGoal: string;
    originalRequest: string;
    taskBreakdown: PlanTask[];
    contextRequired: string[];
    risksAndConsiderations: string[];
    created: number;
    status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'FAILED';
    subtaskResults: Record<string, SubtaskResult>;
}

/**
 * Individual task in a plan
 */
export interface PlanTask {
    id: string;
    type: string;
    description: string;
    priority: string;
    dependencies?: string[];
    estimatedComplexity?: string;
    status: TaskStatus;
    startTime: number | null;
    endTime: number | null;
}

/**
 * Result of a subtask execution
 */
export interface SubtaskResult {
    success: boolean;
    message: string;
    fileOperations?: string[];
    outputs?: string;
    artifacts?: string[];
}

/**
 * Context for agent operations
 */
export interface AgentContext {
    currentTask?: Task;
    taskQueue: Task[];
    taskHistory: Task[];
    metadata: Record<string, any>;
    artifacts: Record<string, any>;
} 
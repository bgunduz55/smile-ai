# Advanced File Operations

Smile AI provides a powerful file operation system to handle AI-generated code changes with precision and safety. This document explains the features and usage of the file operation system.

## Features

### Robust Format Detection

Smile AI can detect file content in multiple formats from AI responses, including:

- Code blocks with language specifiers (````typescript`)
- Code blocks with file paths as first line
- Code blocks with file path attributes
- File content blocks with various header formats
- Alternative XML-like tag formats
- Cursor-style file notation

This flexibility ensures compatibility with various AI models and response formats.

### Multi-File Operations

The system intelligently handles operations involving multiple files:

- Grouping related file changes as a single operation
- Batch processing with single approval
- Directory-based automatic grouping
- Transaction-like behavior (all or nothing)

### Diff-Based Updates

When updating existing files, Smile AI:

- Shows a visual diff of the changes
- Preserves file history
- Enables selective application of changes
- Provides clear indications of what has changed

### Error Recovery

Robust error handling ensures reliable file operations:

- Automatic retries for failed operations
- Alternative approaches for problematic files
- Detailed error information for troubleshooting
- Backup creation before risky operations

### Interactive Approval

Users maintain full control with:

- Preview of all changes before application
- Options to apply all, review individually, or cancel
- Visual diff view for each file change
- Clear operation descriptions

## Technical Implementation

The file operation system consists of three main components:

1. **File Content Extraction**: The `extractAndProcessFileContent` method in `AIEngine.ts` uses multiple regex patterns to identify file content in AI responses.

2. **File Operation Management**: The `FileOperationManager` class handles the creation, tracking, and execution of file operations.

3. **Operation Grouping**: Related operations are intelligently grouped for better management.

## Usage Examples

### Agent Mode

In agent mode, Smile AI automatically detects and processes file operations from AI responses. When the AI suggests file changes:

1. The system extracts file content from the response.
2. It creates appropriate file operations (add, update, delete).
3. It presents these operations to the user for approval.
4. Upon approval, the changes are applied to the workspace.

### Multiple File Changes

When multiple files are modified in a single operation:

1. The system groups related changes together.
2. It presents a summary of all changes.
3. Users can choose to:
   - Apply all changes at once
   - Review each change individually
   - Cancel all changes

### Error Handling

If an error occurs during file operations, Smile AI:

1. Shows a detailed error message.
2. Offers options to retry, use alternative methods, or view details.
3. Provides an output channel with diagnostic information.
4. Creates backups of existing files when appropriate.

## Configuration

The file operation system is designed to work optimally out of the box, but can be customized through VS Code settings:

- **File Operation Behavior**: Controls how file operations are presented and executed.
- **Diff View Settings**: Customizes the appearance of diff previews.
- **Error Recovery Options**: Configures how the system handles operation failures.

---

This advanced file operation system makes Smile AI a powerful tool for code generation and modification, ensuring that AI-generated code changes are applied safely and reliably to your workspace. 
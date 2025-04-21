# Smile AI Troubleshooting Guide

## Common Issues and Solutions

### Indexing Issues

#### Unwanted folders are being indexed (node_modules, .angular, etc.)

The extension should now automatically ignore common folders like `node_modules`, `.angular`, `.vscode`, etc. 
If you're still experiencing issues:

1. Restart VS Code to apply the latest changes
2. Create a `.smileignore` file in your workspace root with glob patterns to exclude additional folders:
   ```
   # Example .smileignore file
   node_modules
   .angular
   .vscode
   dist
   build
   ```

### Code Completion Not Working

If code completion isn't working:

1. Check your settings at: Settings > Extensions > Smile AI
2. Ensure that in `smile-ai.behavior` settings, `autoComplete` and `inlineCompletion` are set to `true`
3. Check the Output panel (View > Output) and select "Smile AI" from the dropdown to see any error logs
4. Restart VS Code after changing settings

To enable completions manually:
1. Open VS Code command palette (Ctrl+Shift+P)
2. Run "Developer: Reload Window" to restart the extension

### Inline Completions (Ghost Text) Not Appearing

If inline completions aren't showing:

1. Make sure you're in a supported language file (TypeScript, JavaScript, Python, etc.)
2. Ensure `smile-ai.behavior.inlineCompletion` is set to `true` in settings
3. Try typing a few characters to trigger the completion
4. Check the Output panel for any errors

### Extension Loading Slowly

If the extension is slow to start:

1. The first indexing of a large workspace can take time. Future sessions should be faster.
2. Consider excluding large folders using a `.smileignore` file
3. Check if you have other heavy extensions that might be competing for resources

### Output Logging

To see detailed logs of what the extension is doing:

1. Open the Output panel (View > Output)
2. Select "Smile AI" from the dropdown menu
3. Look for messages starting with "Smile AI:" for relevant information

If you need to share logs for troubleshooting:

1. Open the Output panel with "Smile AI" selected
2. Right-click and select "Save Output As..."
3. Share the saved log file when reporting issues

### AI Model Issues

If the AI model isn't responding:

1. Ensure your local AI provider (Ollama, LM Studio, etc.) is running
2. Check that the API endpoint in settings matches your provider's endpoint
3. Verify that you have the correct model installed in your AI provider

## Reporting Issues

When reporting issues, please include:
1. Steps to reproduce the problem
2. Extension logs (from the Output panel)
3. Your VS Code version and OS
4. Any error messages you see

Report issues on our [GitHub repository](https://github.com/bgunduz55/smile-ai/issues). 
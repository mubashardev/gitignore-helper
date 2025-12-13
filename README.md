# Gitignore Helper

**Gitignore Helper** is a powerful Visual Studio Code extension designed to streamline the management of your `.gitignore` files. Whether you are adding files, cleaning up rules, or debugging why a file is ignored, this tool has you covered.

## Features

### key Features

- **Add to .gitignore**: Easily add files or folders to your `.gitignore` directly from the file explorer context menu.
- **Remove from .gitignore**: Quickly remove entries from `.gitignore` via the context menu.
- **Generate .gitignore**: Generate a standard `.gitignore` file for your project type (Node, Python, Go, etc.) using the `Generate .gitignore...` command.
- **Clean & Sort**: Automatically clean up duplicate entries and sort your `.gitignore` file for better readability.
- **Check Ignore Status**: Right-click any file and select "Check why file is ignored" to see exactly which rule is affecting it.
- **Global .gitignore Support**: Add files to your global git configuration directly from VS Code.
- **Autocomplete**: Intelligent autocomplete suggestions for files and folders while editing `.gitignore`.

## Usage

### Context Menu
Right-click on any file or folder in the Explorer to access:
- **Add to .gitignore**
- **Remove from .gitignore**
- **Add to Global .gitignore**
- **Check why file is ignored**

### Command Palette
Open the Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`) and type `Gitignore` to see all available commands:
- `Gitignore Helper: Generate .gitignore...`
- `Gitignore Helper: Clean & Sort .gitignore`

## Extension Settings

This extension contributes the following settings:

*   `addToGitignore.onlyInGitProjects`: Show context menu items only when inside a Git repository (default: `false`).
*   `addToGitignore.enableAutocomplete`: Enable autocomplete suggestions for `.gitignore` files (default: `true`).

## Feedback
If you have any suggestions or find any bugs, please reach out or open an issue on our [GitHub repository](https://github.com/mubashardev/gitignore-helper).

**Enjoy coding without the hassle of unignored files!**

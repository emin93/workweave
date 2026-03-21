/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        vscode: {
          bg: "var(--vscode-editor-background)",
          fg: "var(--vscode-editor-foreground)",
          border: "var(--vscode-panel-border)",
          inputBg: "var(--vscode-input-background)",
          inputFg: "var(--vscode-input-foreground)",
          inputBorder: "var(--vscode-input-border)",
          buttonBg: "var(--vscode-button-background)",
          buttonFg: "var(--vscode-button-foreground)",
          buttonHover: "var(--vscode-button-hoverBackground)",
          secondaryBg: "var(--vscode-button-secondaryBackground)",
          secondaryFg: "var(--vscode-button-secondaryForeground)",
          secondaryHover: "var(--vscode-button-secondaryHoverBackground)",
          link: "var(--vscode-textLink-foreground)",
          error: "var(--vscode-errorForeground)",
          warning: "var(--vscode-editorWarning-foreground)",
          success: "var(--vscode-testing-iconPassed)",
          badge: "var(--vscode-badge-background)",
          badgeFg: "var(--vscode-badge-foreground)",
          listHover: "var(--vscode-list-hoverBackground)",
          listActive: "var(--vscode-list-activeSelectionBackground)",
          descFg: "var(--vscode-descriptionForeground)",
        },
      },
      fontSize: {
        vs: "var(--vscode-font-size, 13px)",
      },
      fontFamily: {
        vs: "var(--vscode-font-family, sans-serif)",
      },
    },
  },
  plugins: [],
};

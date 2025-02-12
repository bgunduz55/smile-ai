declare module 'vscode' {
    export interface Uri {
        scheme: string;
        authority: string;
        path: string;
        query: string;
        fragment: string;
        fsPath: string;
        with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri;
        toString(): string;
        toJSON(): any;
    }

    export interface Webview {
        options: WebviewOptions;
        html: string;
        onDidReceiveMessage: (callback: (message: any) => void) => void;
        postMessage: (message: any) => Thenable<boolean>;
        asWebviewUri: (localResource: Uri) => Uri;
        cspSource: string;
    }

    export interface WebviewOptions {
        enableScripts?: boolean;
        enableCommandUris?: boolean;
        localResourceRoots?: readonly Uri[];
        portMapping?: readonly WebviewPortMapping[];
    }

    export interface WebviewPortMapping {
        webviewPort: number;
        extensionHostPort: number;
    }

    export interface WebviewView {
        viewType: string;
        webview: Webview;
        title?: string;
        description?: string;
        badge?: WebviewViewBadge;
        show(preserveFocus?: boolean): void;
        visible: boolean;
    }

    export interface WebviewViewBadge {
        tooltip?: string;
        value: number;
    }

    export interface WebviewViewResolveContext<T = unknown> {
        readonly state: T;
    }

    export interface WebviewViewProvider {
        resolveWebviewView(webviewView: WebviewView, context: WebviewViewResolveContext, token: CancellationToken): void | Thenable<void>;
    }

    export interface CancellationToken {
        isCancellationRequested: boolean;
        onCancellationRequested: Event<any>;
    }

    export interface Event<T> {
        (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
    }

    export interface Disposable {
        dispose(): any;
    }

    export interface ExtensionContext {
        extensionUri: Uri;
        extensionPath: string;
        globalState: Memento;
        workspaceState: Memento;
        subscriptions: { dispose(): any }[];
        asAbsolutePath(relativePath: string): string;
        storageUri: Uri | undefined;
        globalStorageUri: Uri;
        logUri: Uri;
        extensionMode: ExtensionMode;
    }

    export enum ExtensionMode {
        Production = 1,
        Development = 2,
        Test = 3
    }

    export interface Memento {
        get<T>(key: string): T | undefined;
        get<T>(key: string, defaultValue: T): T;
        update(key: string, value: any): Thenable<void>;
        keys(): readonly string[];
    }

    export namespace Uri {
        export function file(path: string): Uri;
        export function parse(uri: string, strict?: boolean): Uri;
        export function joinPath(uri: Uri, ...pathSegments: string[]): Uri;
    }

    export namespace window {
        export function registerWebviewViewProvider(viewId: string, provider: WebviewViewProvider, options?: {
            webviewOptions?: {
                retainContextWhenHidden?: boolean;
            };
        }): Disposable;
        export function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
        export function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
        export function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
        export function createWebviewPanel(viewType: string, title: string, showOptions: ViewColumn | { viewColumn: ViewColumn; preserveFocus?: boolean }, options?: WebviewPanelOptions & WebviewOptions): WebviewPanel;
    }

    export enum ViewColumn {
        Active = -1,
        Beside = -2,
        One = 1,
        Two = 2,
        Three = 3,
        Four = 4,
        Five = 5,
        Six = 6,
        Seven = 7,
        Eight = 8,
        Nine = 9
    }

    export interface WebviewPanel {
        readonly viewType: string;
        title: string;
        iconPath?: Uri | { light: Uri; dark: Uri };
        webview: Webview;
        reveal(viewColumn?: ViewColumn, preserveFocus?: boolean): void;
        dispose(): any;
    }

    export interface WebviewPanelOptions {
        enableFindWidget?: boolean;
        retainContextWhenHidden?: boolean;
    }

    export enum StatusBarAlignment {
        Left = 1,
        Right = 2
    }

    export interface StatusBarItem extends Disposable {
        text: string;
        tooltip?: string;
        command?: string;
        color?: string | ThemeColor;
        backgroundColor?: ThemeColor;
        show(): void;
        hide(): void;
    }

    export class ThemeColor {
        constructor(id: string);
    }

    export namespace workspace {
        export function getConfiguration(section?: string, scope?: ConfigurationScope): WorkspaceConfiguration;
        export const onDidChangeConfiguration: Event<ConfigurationChangeEvent>;
    }

    export interface ConfigurationScope {
        uri?: Uri;
        languageId?: string;
    }

    export interface WorkspaceConfiguration {
        get<T>(section: string): T | undefined;
        get<T>(section: string, defaultValue: T): T;
        has(section: string): boolean;
        inspect<T>(section: string): ConfigurationInspect<T> | undefined;
        update(section: string, value: any, configurationTarget?: ConfigurationTarget | boolean, overrideInLanguage?: boolean): Thenable<void>;
    }

    export interface ConfigurationInspect<T> {
        key: string;
        defaultValue?: T;
        globalValue?: T;
        workspaceValue?: T;
        workspaceFolderValue?: T;
        defaultLanguageValue?: T;
        globalLanguageValue?: T;
        workspaceLanguageValue?: T;
        workspaceFolderLanguageValue?: T;
        languageIds?: string[];
    }

    export interface ConfigurationChangeEvent {
        affectsConfiguration(section: string, scope?: ConfigurationScope): boolean;
    }

    export enum ConfigurationTarget {
        Global = 1,
        Workspace = 2,
        WorkspaceFolder = 3
    }
} 
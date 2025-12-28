import * as vscode from 'vscode';
import * as path from 'path';
import { AdbClient } from './adb';
import { Device, FileEntry } from './models';

// Tree Item Wrapper
export class AndroidItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly contextValue: string,
        public readonly deviceId?: string,
        public readonly path?: string, // Remote path
        public readonly fileEntry?: FileEntry
    ) {
        super(label, collapsibleState);

        if (contextValue === 'device') {
            this.iconPath = new vscode.ThemeIcon('device-mobile');
            this.description = deviceId; // Show ID in description
        } else if (contextValue === 'folder') {
            this.iconPath = vscode.ThemeIcon.Folder;
            this.resourceUri = vscode.Uri.file(label); // Helper for icon theme
            if (this.fileEntry) {
                this.description = `${this.fileEntry.permissions}`;
            }
        } else if (contextValue === 'file') {
            this.iconPath = vscode.ThemeIcon.File;
            this.resourceUri = vscode.Uri.file(label);
            this.command = {
                command: 'androidSystemExplorer.previewFile',
                title: 'Preview File',
                arguments: [this]
            };
            if (this.fileEntry) {
                // Format size
                const size = this.fileEntry.size > 1024
                    ? `${(this.fileEntry.size / 1024).toFixed(1)} KB`
                    : `${this.fileEntry.size} B`;
                this.description = `${size}  •  ${this.fileEntry.permissions}`;
            }
        } else if (contextValue === 'error') {
            this.iconPath = new vscode.ThemeIcon('error');
        }
    }
}

export class DeviceTreeProvider implements vscode.TreeDataProvider<AndroidItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AndroidItem | undefined | null | void> = new vscode.EventEmitter<AndroidItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AndroidItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(private adb: AdbClient) { }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AndroidItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AndroidItem): Promise<AndroidItem[]> {
        if (!element) {
            // Root: List Devices
            const devices = await this.adb.getDevices();
            if (devices.length === 0) {
                return [];
            }
            return devices.map(d => new AndroidItem(
                d.model,
                vscode.TreeItemCollapsibleState.Collapsed,
                'device',
                d.id
            ));
        }

        const deviceId = element.deviceId;
        if (!deviceId) return [];

        if (element.contextValue === 'device') {
            return [
                new AndroidItem('/', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/'),
                new AndroidItem('sdcard', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/sdcard'),
                new AndroidItem('data', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/data'),
            ];
        }

        // Handle folders
        if (element.contextValue === 'folder' && element.path) {
            // Determine if we need run-as
            // Logic: if path starts with /data/data/<package>, use <package>
            let runAsPackage: string | undefined;
            const dataDataPrefix = '/data/data/';
            if (element.path.startsWith(dataDataPrefix)) {
                const parts = element.path.substring(dataDataPrefix.length).split('/');
                if (parts.length > 0 && parts[0]) {
                    runAsPackage = parts[0];
                }
            }

            try {
                const files = await this.adb.listFiles(deviceId, element.path, runAsPackage);

                // Sort
                files.sort((a, b) => {
                    if (a.isDirectory && !b.isDirectory) return -1;
                    if (!a.isDirectory && b.isDirectory) return 1;
                    return a.name.localeCompare(b.name);
                });

                return files.map(f => new AndroidItem(
                    f.name,
                    f.isDirectory ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                    f.isDirectory ? 'folder' : 'file',
                    deviceId,
                    f.path,
                    f
                ));

            } catch (err: any) {
                const errorMessage = err.message || String(err);

                // Special handling for /data/data permission denied -> List Packages
                if (element.path === '/data/data' && errorMessage.includes('Permission denied')) {
                    try {
                        const packages = await this.adb.getInstalledPackages(deviceId);
                        return packages.map(pkg => new AndroidItem(
                            pkg,
                            vscode.TreeItemCollapsibleState.Collapsed,
                            'folder',
                            deviceId,
                            `/data/data/${pkg}`
                        ));
                    } catch (pkgErr) {
                        // Fallback to error item
                    }
                }

                // Fallback for /data permission denied
                if (element.path === '/data' && errorMessage.includes('Permission denied')) {
                    return [
                        new AndroidItem('app', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/data/app'),
                        new AndroidItem('data', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/data/data'),
                        new AndroidItem('local', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/data/local'),
                        new AndroidItem('user', vscode.TreeItemCollapsibleState.Collapsed, 'folder', deviceId, '/data/user'),
                        new AndroidItem(`ls: ${element.path}: Permission denied`, vscode.TreeItemCollapsibleState.None, 'error')
                    ];
                }

                // Create error item
                let label = errorMessage;
                if (errorMessage.includes('Permission denied')) {
                    label = `ls: ${element.path}: Permission denied`;
                } else if (errorMessage.includes('not debuggable')) {
                    label = `run-as: package not debuggable: ${runAsPackage}`;
                }

                const errorItem = new AndroidItem(label, vscode.TreeItemCollapsibleState.None, 'error');
                errorItem.tooltip = errorMessage;
                return [errorItem];
            }
        }

        return [];
    }
}

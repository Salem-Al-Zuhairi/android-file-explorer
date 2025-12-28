import * as vscode from 'vscode';
import { AdbClient } from './adb';
import { DeviceTreeProvider, AndroidItem } from './deviceTreeProvider';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "android-system-explorer" is now active!');

    const adb = new AdbClient();
    const treeProvider = new DeviceTreeProvider(adb);

    vscode.window.registerTreeDataProvider('androidExplorer', treeProvider);

    // Refresh Command
    context.subscriptions.push(
        vscode.commands.registerCommand('androidSystemExplorer.refresh', () => {
            treeProvider.refresh();
        })
    );

    // Download Command
    context.subscriptions.push(
        vscode.commands.registerCommand('androidSystemExplorer.pullFile', async (node: AndroidItem) => {
            if (!node || !node.fileEntry || !node.deviceId || !node.path) {
                vscode.window.showErrorMessage('Please select a file to download.');
                return;
            }

            // Ask user for destination
            const uri = await vscode.window.showOpenDialog({
                canSelectFiles: false,
                canSelectFolders: true,
                canSelectMany: false,
                openLabel: 'Select Destination'
            });

            if (uri && uri[0]) {
                const targetDir = uri[0].fsPath;
                const targetPath = path.join(targetDir, node.fileEntry.name);

                vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Downloading ${node.fileEntry.name}...`,
                    cancellable: false
                }, async () => {
                    try {
                        // Determine runAsPackage from path
                        let runAsPackage: string | undefined;
                        if (node.path && node.path.startsWith('/data/data/')) {
                            const parts = node.path.split('/');
                            if (parts.length > 3) {
                                runAsPackage = parts[3];
                            }
                        }

                        await adb.pullFile(node.deviceId!, node.path!, targetPath, runAsPackage);
                        vscode.window.showInformationMessage(`Successfully downloaded to ${targetPath}`);
                    } catch (err) {
                        vscode.window.showErrorMessage(`Failed to download file: ${err}`);
                    }
                });
            }
        })
    );

    // Root Command
    context.subscriptions.push(
        vscode.commands.registerCommand('androidSystemExplorer.rootDevice', async (node: AndroidItem) => {
            if (!node || node.contextValue !== 'device' || !node.deviceId) {
                vscode.window.showErrorMessage('Please select a device to root.');
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Restarting ADB as Root for ${node.deviceId}...`,
                cancellable: false
            }, async () => {
                try {
                    const result = await adb.root(node.deviceId!);
                    vscode.window.showInformationMessage(`ADB Root: ${result}`);
                    // Devices might disconnect briefly, wait a bit then refresh
                    setTimeout(() => treeProvider.refresh(), 2000);
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to restart as root: ${err}`);
                }
            });
        })
    );

    // Optional: Preview/Open file (downloads to temp and opens)
    context.subscriptions.push(vscode.commands.registerCommand('androidSystemExplorer.previewFile', (node) =>
        vscode.commands.executeCommand('androidSystemExplorer.openFile', node)
    ));

    // Open File (Download to Temp and Open)
    context.subscriptions.push(
        vscode.commands.registerCommand('androidSystemExplorer.openFile', async (node: AndroidItem) => {
            if (!node || !node.fileEntry || !node.deviceId || !node.path) return;

            // Create temp uri
            const tempDir = process.env.TEMP || '/tmp';
            // Flatten path for unique filename: data_data_pkg_file.txt
            const safeName = node.path.replace(/[\/\\]/g, '_').replace(/^_+/, '');
            const tempFilePath = path.join(tempDir, safeName);

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Opening ${node.fileEntry.name}...`,
                cancellable: false
            }, async () => {
                try {
                    let runAsPackage: string | undefined;
                    if (node.path && node.path.startsWith('/data/data/')) {
                        const parts = node.path.split('/');
                        if (parts.length > 3) runAsPackage = parts[3];
                    }

                    await adb.pullFile(node.deviceId!, node.path!, tempFilePath, runAsPackage);

                    // Use vscode.open to let VS Code handle opening (supports binary, images, etc.)
                    await vscode.commands.executeCommand('vscode.open', vscode.Uri.file(tempFilePath));
                } catch (err) {
                    vscode.window.showErrorMessage(`Failed to open file: ${err}`);
                }
            });
        })
    );

    // Copy Path
    context.subscriptions.push(
        vscode.commands.registerCommand('androidSystemExplorer.copyPath', async (node: AndroidItem) => {
            if (node && node.path) {
                await vscode.env.clipboard.writeText(node.path);
                // Optional: show status bar message
                vscode.window.setStatusBarMessage(`Copied path: ${node.path}`, 3000);
            }
        })
    );

    // Synchronize (Refresh)
    context.subscriptions.push(
        vscode.commands.registerCommand('androidSystemExplorer.synchronize', (node: AndroidItem) => {
            // Ideally we refresh just the node, but our provider currently triggers "onDidChangeTreeData" for everything
            // or we can pass the node to refresh logic.
            // For now, full refresh is safer or refresh specific item if provider supports it.
            // TreeDataProvider refresh usually takes an element to refresh ONLY that element.
            // Let's modify refresh to accept generic.
            treeProvider.refresh(/* node */);
        })
    );
}

export function deactivate() { }

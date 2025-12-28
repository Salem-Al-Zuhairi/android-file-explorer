import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { Device, FileEntry } from './models';

const execAsync = promisify(exec);

export class AdbClient {
    constructor(private adbPath: string = 'adb') { }

    async getDevices(): Promise<Device[]> {
        try {
            const { stdout } = await execAsync(`${this.adbPath} devices -l`);
            const lines = stdout.split('\n').filter(line => line.trim() !== '');
            // Skip first line "List of devices attached"

            const devices: Device[] = [];
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i];
                // Example: emulator-5554 device product:sdk_gphone64_x86_64 model:sdk_gphone64_x86_64 device:emulator64_x86_64_arm64 transport_id:1
                const parts = line.split(/\s+/);
                if (parts.length >= 2) {
                    const id = parts[0];
                    const status = parts[1];
                    let model = 'Unknown';

                    const modelPart = parts.find(p => p.startsWith('model:'));
                    if (modelPart) {
                        model = modelPart.split(':')[1];
                    }

                    devices.push({ id, status, model });
                }
            }
            return devices;
        } catch (error) {
            console.error('Error fetching devices:', error);
            // If adb is not found/fails
            return [];
        }
    }

    async getInstalledPackages(deviceId: string): Promise<string[]> {
        try {
            const { stdout } = await execAsync(`${this.adbPath} -s ${deviceId} shell pm list packages`);
            return stdout.split('\n')
                .filter(line => line.startsWith('package:'))
                .map(line => line.replace('package:', '').trim())
                .sort();
        } catch (error) {
            console.error('Error fetching packages:', error);
            return [];
        }
    }

    async listFiles(deviceId: string, remotePath: string, runAsPackage?: string): Promise<FileEntry[]> {
        // Adjust path to handle trailing slash
        let targetPath = remotePath.endsWith('/') ? remotePath : remotePath + '/';

        let command = `${this.adbPath} -s ${deviceId} shell ls -Al "${targetPath}"`;
        if (runAsPackage) {
            command = `${this.adbPath} -s ${deviceId} shell run-as ${runAsPackage} ls -Al "${targetPath}"`;
        }

        try {
            const { stdout } = await execAsync(command);

            const files: FileEntry[] = [];
            const lines = stdout.split('\n');

            for (const line of lines) {
                const trimmed = line.trim();
                // Check if line indicates an error (run-as writes to stdout/stderr mixed sometimes)
                if (!trimmed || trimmed.startsWith('total') || trimmed.includes('not debuggable')) continue;

                // Regex to capture parts
                const match = trimmed.match(/^([d\-\w]+)\s+\d+\s+\w+\s+\w+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}|\w{3}\s+\d+\s+\d{2}:\d{2}|\d{4}-\d{2}-\d{2})\s+(.+)$/);

                if (match) {
                    const perms = match[1];
                    const size = parseInt(match[2]);
                    const date = match[3]; // Date formats vary heavily on Android versions
                    const name = match[4];

                    if (name === '.' || name === '..') continue;

                    files.push({
                        name,
                        path: path.posix.join(remotePath, name), // Use posix join for Android paths
                        isDirectory: perms.startsWith('d'),
                        size,
                        permissions: perms,
                        date
                    });
                } else {
                    // Fallback simpler parsing if regex fails (e.g. different date format)
                    const parts = trimmed.split(/\s+/);
                    if (parts.length > 7) {
                        const perms = parts[0];
                        const name = parts.slice(7).join(' '); // Rejoin the rest as name
                        if (name === '.' || name === '..') continue;

                        files.push({
                            name,
                            path: path.posix.join(remotePath, name),
                            isDirectory: perms.startsWith('d'),
                            size: parseInt(parts[4]) || 0,
                            permissions: perms,
                            date: parts.slice(5, 7).join(' ')
                        });
                    }
                }
            }
            return files;
        } catch (error) {
            console.error(`Error listing files for ${remotePath}:`, error);
            throw error;
        }
    }

    async pullFile(deviceId: string, remotePath: string, localPath: string, runAsPackage?: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const fs = require('fs');
            const { spawn } = require('child_process');

            if (runAsPackage) {
                // Use exec-out with cat to stream file content
                // Note: exec-out is required to avoid TTY mangling of binary data
                // Command: adb -s <id> exec-out run-as <pkg> cat <remote>
                const adbArgs = ['-s', deviceId, 'exec-out', 'run-as', runAsPackage, 'cat', remotePath];
                const child = spawn(this.adbPath, adbArgs);
                const fileStream = fs.createWriteStream(localPath);

                child.stdout.pipe(fileStream);

                child.stderr.on('data', (data: any) => {
                    console.error(`adb pull stderr: ${data}`);
                });

                child.on('close', (code: number) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`adb pull failed with code ${code}`));
                    }
                });

                child.on('error', (err: any) => reject(err));
            } else {
                // Standard pull
                const child = spawn(this.adbPath, ['-s', deviceId, 'pull', remotePath, localPath]);

                child.stderr.on('data', (data: any) => {
                    // adb pull writes stats to stderr
                });

                child.on('close', (code: number) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`adb pull failed with code ${code}`));
                    }
                });

                child.on('error', (err: any) => reject(err));
            }
        });
    }

    async root(deviceId: string): Promise<string> {
        const { stdout } = await execAsync(`${this.adbPath} -s ${deviceId} root`);
        return stdout;
    }
}

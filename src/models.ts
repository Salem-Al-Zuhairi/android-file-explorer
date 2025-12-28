export interface Device {
    id: string;
    model: string;
    status: string; // 'device', 'offline', 'unauthorized'
}

export interface FileEntry {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    permissions: string;
    date: string;
}

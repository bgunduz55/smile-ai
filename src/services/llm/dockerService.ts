import * as vscode from 'vscode';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface DockerContainer {
    id: string;
    name: string;
    status: string;
    ports: string;
}

export class DockerService {
    private static instance: DockerService;
    private isDockerRunning: boolean = false;
    private statusBarItem: vscode.StatusBarItem;

    private constructor() {
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right);
        this.updateStatusBar();
        this.checkDockerStatus();
    }

    public static getInstance(): DockerService {
        if (!DockerService.instance) {
            DockerService.instance = new DockerService();
        }
        return DockerService.instance;
    }

    private updateStatusBar(): void {
        if (this.isDockerRunning) {
            this.statusBarItem.text = "$(docker) Docker";
            this.statusBarItem.tooltip = "Docker is running";
        } else {
            this.statusBarItem.text = "$(error) Docker";
            this.statusBarItem.tooltip = "Docker is not running";
        }

        this.statusBarItem.show();
    }

    private async checkDockerStatus(): Promise<void> {
        try {
            await execAsync('docker info');
            this.isDockerRunning = true;
        } catch (error) {
            this.isDockerRunning = false;
            console.error('Docker control error:', error);
        }
        this.updateStatusBar();

    }

    public async isContainerRunning(containerName: string): Promise<boolean> {
        try {
            const { stdout } = await execAsync(`docker ps --filter "name=${containerName}" --format "{{.Names}}"`);
            return stdout.trim() === containerName;
        } catch (error) {
            return false;
        }
    }

    public async startContainer(
        containerName: string, 
        image: string, 
        ports: string[], 
        volumes: string[],
        envVars: Record<string, string> = {}
    ): Promise<void> {
        if (!this.isDockerRunning) {
            throw new Error('Docker service is not accessible. Please ensure Docker is running.');
        }


        const isRunning = await this.isContainerRunning(containerName);
        if (isRunning) {
            return; // Container is already running
        }

        
        // First remove the old container
        await this.removeContainer(containerName);


        // Start the container
        const args = [
            'run',
            '-d',
            '--name', containerName,
            ...ports.flatMap(port => ['-p', port]),
            ...volumes.flatMap(volume => ['-v', volume]),

            ...Object.entries(envVars).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
            '--restart', 'unless-stopped',
            image
        ];

        try {
            const process = spawn('docker', args);
            return new Promise((resolve, reject) => {
                process.on('close', (code) => {
                    if (code === 0) {
                        resolve();
                    } else {
                        reject(new Error(`Container failed to start (exit code: ${code})`));
                    }

                });
                process.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Container start error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }


    public async stopContainer(containerName: string): Promise<void> {
        try {
            await execAsync(`docker stop ${containerName}`);
        } catch (error) {
            console.error('Container stop error:', error);
        }

    }

    public async removeContainer(containerName: string): Promise<void> {
        try {
            await execAsync(`docker rm -f ${containerName}`);
        } catch (error) {
            // If the container does not exist, do not throw an error
            if (error instanceof Error && !error.message.includes('No such container')) {
                console.error('Container removal error:', error);
            }

        }
    }

    public async pullImage(image: string, onProgress?: (progress: number) => void): Promise<void> {
        return new Promise((resolve, reject) => {
            const process = spawn('docker', ['pull', image]);
            let totalLayers = 0;
            let completedLayers = 0;

            process.stdout.on('data', (data) => {
                const output = data.toString();
                if (output.includes('Pulling from')) {
                    // New layer started
                    totalLayers++;
                }

                if (output.includes('Download complete') || output.includes('Pull complete')) {
                    // Layer completed
                    completedLayers++;
                    if (onProgress && totalLayers > 0) {
                        onProgress((completedLayers / totalLayers) * 100);
                    }
                }

            });

            process.on('close', (code) => {
                if (code === 0) {
                    resolve();
                } else {
                    reject(new Error(`Image download error (exit code: ${code})`));
                }

            });

            process.on('error', reject);
        });
    }

    public async getContainerLogs(containerName: string, lines: number = 100): Promise<string> {
        try {
            const { stdout } = await execAsync(`docker logs --tail ${lines} ${containerName}`);
            return stdout;
        } catch (error) {
            throw new Error(`Container log error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }


    public async listContainers(): Promise<DockerContainer[]> {
        try {
            const { stdout } = await execAsync(
                'docker ps -a --format "{{.ID}}\\t{{.Names}}\\t{{.Status}}\\t{{.Ports}}"'
            );
            
            return stdout.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [id, name, status, ports] = line.split('\t');
                    return { id, name, status, ports };
                });
        } catch (error) {
            console.error('Container listing error:', error);
            return [];
        }

    }

    public async getContainerStats(containerName: string): Promise<{
        cpuUsage: number;
        memoryUsage: number;
        networkIO: { rx: number; tx: number };
    }> {
        try {
            const { stdout } = await execAsync(
                `docker stats ${containerName} --no-stream --format "{{.CPUPerc}}\\t{{.MemUsage}}\\t{{.NetIO}}"`
            );
            
            const [cpu, memory, network] = stdout.split('\t');
            const [memUsed] = memory.split(' / ');
            const [netRx, netTx] = network.split(' / ');

            return {
                cpuUsage: parseFloat(cpu.replace('%', '')),
                memoryUsage: parseFloat(memUsed),
                networkIO: {
                    rx: this.parseSize(netRx),
                    tx: this.parseSize(netTx)
                }
            };
        } catch (error) {
            throw new Error(`Container statistics error: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private parseSize(size: string): number {
        const units = {
            'B': 1,
            'kB': 1024,
            'MB': 1024 * 1024,
            'GB': 1024 * 1024 * 1024
        };
        
        const match = size.match(/^([\d.]+)\s*([kMG]?B)$/);
        if (!match) return 0;
        
        const value = parseFloat(match[1]);
        const unit = match[2] as keyof typeof units;
        return value * units[unit];
    }

    public dispose(): void {
        this.statusBarItem.dispose();
    }
} 
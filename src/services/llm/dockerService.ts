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
            this.statusBarItem.tooltip = "Docker çalışıyor";
        } else {
            this.statusBarItem.text = "$(error) Docker";
            this.statusBarItem.tooltip = "Docker çalışmıyor";
        }
        this.statusBarItem.show();
    }

    private async checkDockerStatus(): Promise<void> {
        try {
            await execAsync('docker info');
            this.isDockerRunning = true;
        } catch (error) {
            this.isDockerRunning = false;
            console.error('Docker kontrol hatası:', error);
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
            throw new Error('Docker servisine erişilemiyor. Docker\'ın çalıştığından emin olun.');
        }

        const isRunning = await this.isContainerRunning(containerName);
        if (isRunning) {
            return; // Container zaten çalışıyor
        }

        // Önce eski container'ı temizle
        await this.removeContainer(containerName);

        // Container'ı başlat
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
                        reject(new Error(`Container başlatılamadı (exit code: ${code})`));
                    }
                });
                process.on('error', reject);
            });
        } catch (error) {
            throw new Error(`Container başlatma hatası: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
        }
    }

    public async stopContainer(containerName: string): Promise<void> {
        try {
            await execAsync(`docker stop ${containerName}`);
        } catch (error) {
            console.error('Container durdurma hatası:', error);
        }
    }

    public async removeContainer(containerName: string): Promise<void> {
        try {
            await execAsync(`docker rm -f ${containerName}`);
        } catch (error) {
            // Eğer container zaten yoksa hata verme
            if (error instanceof Error && !error.message.includes('No such container')) {
                console.error('Container silme hatası:', error);
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
                    // Yeni layer başladı
                    totalLayers++;
                }
                if (output.includes('Download complete') || output.includes('Pull complete')) {
                    // Layer tamamlandı
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
                    reject(new Error(`Image indirme hatası (exit code: ${code})`));
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
            throw new Error(`Container log hatası: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
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
            console.error('Container listeleme hatası:', error);
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
            throw new Error(`Container istatistik hatası: ${error instanceof Error ? error.message : 'Bilinmeyen hata'}`);
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
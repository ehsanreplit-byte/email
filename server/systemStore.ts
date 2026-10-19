import { storage } from './storage';

export interface SystemConfig {
  maintenance: boolean;
  maintenanceMessage: string;
}

const CONFIG_FILE = 'system_config.json';

class SystemStore {
  private config: SystemConfig = {
    maintenance: false,
    maintenanceMessage: 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.',
  };

  constructor() {
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (storage.existsSync(CONFIG_FILE)) {
        const raw = storage.readFileSync(CONFIG_FILE);
        const parsed = JSON.parse(raw);
        this.config = {
          maintenance: typeof parsed.maintenance === 'boolean' ? parsed.maintenance : false,
          maintenanceMessage: parsed.maintenanceMessage || 'سیستم در حال بروز رسانی است. لطفاً شکیبا باشید.',
        };
      } else {
        this.saveConfig();
      }
    } catch (err) {
      console.error('[SystemStore] Failed to load system config:', err);
    }
  }

  private saveConfig(): void {
    try {
      storage.writeFileSync(CONFIG_FILE, JSON.stringify(this.config, null, 2));
    } catch (err) {
      console.error('[SystemStore] Failed to save system config:', err);
    }
  }

  public loadFromStorage(): void {
    this.loadConfig();
  }

  public getConfig(): SystemConfig {
    return { ...this.config };
  }

  public isMaintenance(): boolean {
    return this.config.maintenance;
  }

  public updateConfig(newCfg: Partial<SystemConfig>): SystemConfig {
    this.config = {
      ...this.config,
      ...newCfg,
    };
    this.saveConfig();
    return this.getConfig();
  }
}

export const systemStore = new SystemStore();

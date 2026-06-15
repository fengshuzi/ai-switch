import { App, ItemView, Modal, Notice, normalizePath, Platform, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf } from 'obsidian';
import * as fs from 'fs';
import { homedir, hostname } from 'os';
import { basename, dirname, join, relative } from 'path';

const VIEW_TYPE_AI_SWITCH = 'ai-switch-view';

interface ConfigManagerSettings {
  configRootFolder: string;
  tools: Record<ToolId, ToolConfig>;
  customSources: CustomConfigSource[];
}

interface LegacyConfigManagerSettings {
  configRootFolder?: string;
  tools?: Record<ToolId, ToolConfig>;
  customSources?: CustomConfigSource[];
  syncSourcesText?: string;
  currentMachineName?: string;
}

type ToolId = 'codex' | 'claude' | 'opencode';

interface ToolConfig {
  enabled: boolean;
  path: string;
}

interface ToolDefinition {
  id: ToolId;
  name: string;
  defaultPath: string;
}

interface CustomConfigSource {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
}

interface ConfigSource {
  id: string;
  name: string;
  path: string;
}

const DEFAULT_SETTINGS: ConfigManagerSettings = {
  configRootFolder: 'Config Manager',
  tools: {
    codex: { enabled: true, path: '~/.codex/config.toml' },
    claude: { enabled: true, path: '~/.claude/settings.json' },
    opencode: { enabled: true, path: '~/.config/opencode/opencode.json' }
  },
  customSources: []
};

const TOOL_DEFINITIONS: ToolDefinition[] = [
  { id: 'codex', name: 'Codex', defaultPath: '~/.codex/config.toml' },
  { id: 'claude', name: 'Claude', defaultPath: '~/.claude/settings.json' },
  { id: 'opencode', name: 'OpenCode', defaultPath: '~/.config/opencode/opencode.json' }
];

const SUPPORTED_CONFIG_EXTENSIONS = new Set(['json', 'toml', 'yaml', 'yml', 'py', 'sh', 'md', 'java', 'php']);

export default class ConfigManagerPlugin extends Plugin {
  settings: ConfigManagerSettings = DEFAULT_SETTINGS;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.registerView(
      VIEW_TYPE_AI_SWITCH,
      (leaf) => new AISwitchView(leaf, this)
    );

    this.addRibbonIcon('folder-cog', 'Open AI Switch', () => {
      void this.activateView();
    });

    this.addCommand({
      id: 'open-view',
      name: 'Open view',
      callback: () => {
        void this.activateView();
      }
    });

    this.addCommand({
      id: 'sync-config-snapshots',
      name: 'Sync config snapshots',
      callback: () => {
        void this.syncConfigSnapshots();
      }
    });

    this.addSettingTab(new ConfigManagerSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      void this.syncConfigSnapshots(false);
    });
  }

  async loadSettings(): Promise<void> {
    const loadedSettings = Object.assign({}, await this.loadData()) as LegacyConfigManagerSettings;
    this.settings = {
      configRootFolder: loadedSettings.configRootFolder || DEFAULT_SETTINGS.configRootFolder,
      tools: mergeToolSettings(loadedSettings),
      customSources: (loadedSettings.customSources ?? [])
        .filter(isValidCustomSource)
        .map((source) => ({ ...source, id: toSourceSlug(source.name) }))
    };

    if (loadedSettings.currentMachineName !== undefined || loadedSettings.syncSourcesText !== undefined) {
      await this.saveData(this.settings);
    }
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    await this.refreshOpenViews();
  }

  async activateView(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_SWITCH);
    let leaf = leaves[0];

    if (!leaf) {
      const leftLeaf = this.app.workspace.getLeftLeaf(true);
      if (leftLeaf) {
        await leftLeaf.setViewState({ type: VIEW_TYPE_AI_SWITCH, active: true });
        leaf = leftLeaf;
      }
    }

    if (!leaf) {
      new Notice('Unable to open AI Switch.');
      return;
    }

    await this.app.workspace.revealLeaf(leaf);
  }

  async syncConfigSnapshots(showNotice = true): Promise<void> {
    if (!Platform.isDesktop) {
      if (showNotice) new Notice('Syncing local config files is only available on desktop.');
      return;
    }

    const rootFolder = normalizeFolderPath(this.settings.configRootFolder);
    const machineName = getCurrentMachineName();
    const sources = this.getAllEnabledSources();

    if (!rootFolder || !machineName) {
      if (showNotice) new Notice('Unable to detect config snapshot target.');
      return;
    }

    if (sources.length === 0) {
      if (showNotice) new Notice('Enable at least one AI tool in settings.');
      return;
    }

    let syncedCount = 0;
    let missingCount = 0;

    for (const source of sources) {
      const sourcePath = expandHomePath(source.path);
      if (!fs.existsSync(sourcePath)) {
        missingCount++;
        continue;
      }

      const stat = fs.statSync(sourcePath);
      const files = stat.isDirectory()
        ? collectConfigFiles(sourcePath)
        : [sourcePath];

      for (const filePath of files) {
        if (!isSupportedConfigFile(filePath)) continue;

        const sourceMtime = (stat.isDirectory() ? fs.statSync(filePath) : stat).mtimeMs;
        const fileName = stat.isDirectory() ? relative(sourcePath, filePath) : basename(filePath);
        const targetPath = normalizePath(`${rootFolder}/${machineName}/${source.id}/${fileName}.md`);

        const existingFile = this.app.vault.getAbstractFileByPath(targetPath);
        if (existingFile instanceof TFile && existingFile.stat.mtime > sourceMtime) {
          syncedCount++;
          continue;
        }

        const sourceContent = fs.readFileSync(filePath, 'utf8');
        const content = toMarkdownSnapshot(fileName, filePath, sourceContent);
        await this.writeVaultFile(targetPath, content);
        syncedCount++;
      }
    }

    await this.removeLegacyPreviewFolder(rootFolder);
    await this.removeLegacyRawSnapshots(rootFolder, machineName, sources);

    if (showNotice) {
      new Notice(`Synced ${syncedCount} config files${missingCount > 0 ? `, skipped ${missingCount} missing paths` : ''}.`);
    }

    await this.refreshOpenViews();
  }

  async applyToolSnapshot(sourceId: string): Promise<void> {
    if (!Platform.isDesktop) {
      new Notice('Applying config files is only available on desktop.');
      return;
    }

    const source = this.getSource(sourceId);
    if (!source) return;

    const localPath = expandHomePath(source.path);
    const snapshotFile = this.getToolSnapshotFile(sourceId);

    if (!snapshotFile) {
      new Notice(`No ${source.name} snapshot found for this machine.`);
      return;
    }

    const snapshotContent = await this.app.vault.cachedRead(snapshotFile);
    const configContent = extractFirstCodeBlock(snapshotContent);
    if (configContent === null) {
      new Notice(`No code block found in ${snapshotFile.path}.`);
      return;
    }

    new ConfirmApplyModal(this.app, source.name, snapshotFile.path, localPath, async () => {
      await this.writeLocalConfig(localPath, configContent);
      new Notice(`Applied ${source.name} config.`);
    }).open();
  }

  getToolSnapshotFile(sourceId: string): TFile | null {
    const rootFolder = normalizeFolderPath(this.settings.configRootFolder);
    const machineName = getCurrentMachineName();
    const toolFolderPath = `${rootFolder}/${machineName}/${sourceId}`;
    const files = this.app.vault.getFiles()
      .filter((file) => file.path.startsWith(`${toolFolderPath}/`) && file.extension === 'md')
      .sort((a, b) => a.path.localeCompare(b.path));

    return files[0] ?? null;
  }

  getEnabledTools(): ToolDefinition[] {
    return TOOL_DEFINITIONS.filter((tool) => this.settings.tools[tool.id].enabled);
  }

  getAllEnabledSources(): ConfigSource[] {
    const builtin: ConfigSource[] = TOOL_DEFINITIONS
      .filter((tool) => this.settings.tools[tool.id].enabled)
      .map((tool) => ({
        id: tool.id,
        name: tool.name,
        path: this.settings.tools[tool.id].path || tool.defaultPath
      }));

    const custom: ConfigSource[] = this.settings.customSources
      .filter((source) => source.enabled && source.name.trim() && source.path.trim())
      .map((source) => ({
        id: source.id,
        name: source.name.trim(),
        path: source.path.trim()
      }));

    return [...builtin, ...custom];
  }

  getSource(id: string): ConfigSource | null {
    const builtin = TOOL_DEFINITIONS.find((tool) => tool.id === id);
    if (builtin) {
      return {
        id: builtin.id,
        name: builtin.name,
        path: this.settings.tools[builtin.id].path || builtin.defaultPath
      };
    }

    const custom = this.settings.customSources.find((source) => source.id === id);
    if (custom) {
      return { id: custom.id, name: custom.name, path: custom.path };
    }

    return null;
  }

  getCurrentMachineName(): string {
    return getCurrentMachineName();
  }

  private async writeLocalConfig(path: string, content: string): Promise<void> {
    const backupPath = `${path}.bak-${formatTimestamp(new Date())}`;

    if (fs.existsSync(path)) {
      fs.copyFileSync(path, backupPath);
    }

    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, content, 'utf8');
  }

  private async refreshOpenViews(): Promise<void> {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_AI_SWITCH);
    await Promise.all(leaves.map(async (leaf) => {
      if (leaf.view instanceof AISwitchView) {
        await leaf.view.refresh();
      }
    }));
  }

  private async writeVaultFile(path: string, content: string): Promise<void> {
    await this.ensureFolder(path.split('/').slice(0, -1).join('/'));

    const existingFile = this.app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
      await this.app.vault.modify(existingFile, content);
      return;
    }

    await this.app.vault.create(path, content);
  }

  private async ensureFolder(folderPath: string): Promise<void> {
    const parts = folderPath.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part;

      if (!this.app.vault.getAbstractFileByPath(currentPath)) {
        await this.app.vault.createFolder(currentPath);
      }
    }
  }

  private async removeLegacyPreviewFolder(rootFolder: string): Promise<void> {
    const previewFolder = this.app.vault.getAbstractFileByPath(`${rootFolder}/_preview`);
    if (previewFolder) {
      await this.app.fileManager.trashFile(previewFolder);
    }
  }

  private async removeLegacyRawSnapshots(rootFolder: string, machineName: string, sources: ConfigSource[]): Promise<void> {
    for (const source of sources) {
      const toolFolderPath = `${rootFolder}/${machineName}/${source.id}`;
      const files = this.app.vault.getFiles().filter((file) => {
        return file.path.startsWith(`${toolFolderPath}/`) && isSupportedConfigFile(file.path);
      });

      for (const file of files) {
        await this.app.fileManager.trashFile(file);
      }
    }
  }
}

class AISwitchView extends ItemView {
  private plugin: ConfigManagerPlugin;

  constructor(leaf: WorkspaceLeaf, plugin: ConfigManagerPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_AI_SWITCH;
  }

  getDisplayText(): string {
    return 'AI Switch';
  }

  getIcon(): string {
    return 'folder-cog';
  }

  async onOpen(): Promise<void> {
    await this.refresh();
  }

  async refresh(): Promise<void> {
    const container = this.contentEl;
    container.empty();
    container.addClass('ai-switch-view');

    container.createEl('h3', { text: 'AI Switch' });
    container.createDiv({ cls: 'ai-switch-machine', text: this.plugin.getCurrentMachineName() });

    const syncAllButton = container.createEl('button', { text: 'Sync all to notes', cls: 'ai-switch-full-button' });
    syncAllButton.onclick = () => {
      void this.plugin.syncConfigSnapshots();
    };

    const sources = this.plugin.getAllEnabledSources();
    if (sources.length === 0) {
      container.createDiv({ cls: 'ai-switch-empty', text: 'Enable at least one source in settings.' });
      return;
    }

    sources.forEach((source) => this.renderSource(container, source));
  }

  private renderSource(container: HTMLElement, source: ConfigSource): void {
    const snapshotFile = this.plugin.getToolSnapshotFile(source.id);
    const toolEl = container.createDiv({ cls: 'ai-switch-tool' });

    toolEl.createDiv({ cls: 'ai-switch-tool-title', text: source.name });
    toolEl.createDiv({ cls: 'ai-switch-path', text: source.path });
    toolEl.createDiv({ cls: 'ai-switch-path', text: snapshotFile ? snapshotFile.path : 'No snapshot for current machine' });

    const actionsEl = toolEl.createDiv({ cls: 'ai-switch-actions' });
    const syncButton = actionsEl.createEl('button', { text: 'Sync to note' });
    syncButton.onclick = () => {
      void this.plugin.syncConfigSnapshots();
    };

    const applyButton = actionsEl.createEl('button', { text: 'Apply to local' });
    applyButton.disabled = snapshotFile === null;
    applyButton.onclick = () => {
      void this.plugin.applyToolSnapshot(source.id);
    };
  }
}

class ConfirmApplyModal extends Modal {
  private toolName: string;
  private snapshotPath: string;
  private localPath: string;
  private onConfirm: () => Promise<void>;

  constructor(app: App, toolName: string, snapshotPath: string, localPath: string, onConfirm: () => Promise<void>) {
    super(app);
    this.toolName = toolName;
    this.snapshotPath = snapshotPath;
    this.localPath = localPath;
    this.onConfirm = onConfirm;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl('h2', { text: `Apply ${this.toolName} config?` });
    contentEl.createEl('p', { text: 'This will overwrite the local config after creating a timestamped backup.' });
    contentEl.createEl('p', { text: `From: ${this.snapshotPath}` });
    contentEl.createEl('p', { text: `To: ${this.localPath}` });

    const buttonsEl = contentEl.createDiv({ cls: 'ai-switch-modal-actions' });
    const cancelButton = buttonsEl.createEl('button', { text: 'Cancel' });
    cancelButton.onclick = () => this.close();

    const confirmButton = buttonsEl.createEl('button', { text: 'Apply' });
    confirmButton.addClass('mod-warning');
    confirmButton.onclick = () => {
      void this.onConfirm().finally(() => this.close());
    };
  }
}

class ConfigManagerSettingTab extends PluginSettingTab {
  private plugin: ConfigManagerPlugin;

  constructor(app: App, plugin: ConfigManagerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName('Config root folder')
      .setDesc('Vault-relative folder that stores machine/tool configuration snapshots.')
      .addText((text) => {
        text
          .setPlaceholder(DEFAULT_SETTINGS.configRootFolder)
          .setValue(this.plugin.settings.configRootFolder)
          .onChange((value) => {
            this.plugin.settings.configRootFolder = value.trim() || DEFAULT_SETTINGS.configRootFolder;
            void this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName('AI tool configs')
      .setDesc('Enable the tools you want to sync. Default paths are prefilled; change them only if your config is elsewhere.');

    TOOL_DEFINITIONS.forEach((tool) => {
      const config = this.plugin.settings.tools[tool.id];

      new Setting(containerEl)
        .setName(tool.name)
        .setDesc(`Default: ${tool.defaultPath}`)
        .addToggle((toggle) => {
          toggle
            .setValue(config.enabled)
            .onChange((value) => {
              config.enabled = value;
              void this.plugin.saveSettings();
            });
        })
        .addText((text) => {
          text
            .setPlaceholder(tool.defaultPath)
            .setValue(config.path)
            .onChange((value) => {
              config.path = value.trim() || tool.defaultPath;
              void this.plugin.saveSettings();
            });
        });
    });

    new Setting(containerEl)
      .setName('Custom config sources')
      .setDesc('Add custom config files or folders by name and path.');

    this.plugin.settings.customSources.forEach((source, index) => {
      const setting = new Setting(containerEl)
        .addText((text) => {
          text
            .setPlaceholder('Name')
            .setValue(source.name)
            .onChange((value) => {
              const trimmed = value.trim();
              this.plugin.settings.customSources[index].name = trimmed;
              this.plugin.settings.customSources[index].id = toSourceSlug(trimmed);
              void this.plugin.saveSettings();
            });
        })
        .addText((text) => {
          text
            .setPlaceholder('~/.config/tool')
            .setValue(source.path)
            .onChange((value) => {
              this.plugin.settings.customSources[index].path = value.trim();
              void this.plugin.saveSettings();
            });
        })
        .addToggle((toggle) => {
          toggle
            .setValue(source.enabled)
            .onChange((value) => {
              this.plugin.settings.customSources[index].enabled = value;
              void this.plugin.saveSettings();
            });
        })
        .addExtraButton((button) => {
          button
            .setIcon('trash')
            .setTooltip('Remove')
            .onClick(() => {
              this.plugin.settings.customSources.splice(index, 1);
              void this.plugin.saveSettings();
              this.display();
            });
        });

      setting.infoEl.remove();
    });

    new Setting(containerEl)
      .addButton((button) => {
        button
          .setButtonText('Add custom source')
          .setIcon('plus')
          .onClick(() => {
            this.plugin.settings.customSources.push({
              id: '',
              name: '',
              path: '',
              enabled: true
            });
            void this.plugin.saveSettings();
            this.display();
          });
      });
  }
}

function toSourceSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function isValidCustomSource(source: unknown): source is CustomConfigSource {
  if (typeof source !== 'object' || source === null) return false;
  const record = source as Record<string, unknown>;
  return typeof record.id === 'string'
    && typeof record.name === 'string'
    && typeof record.path === 'string'
    && typeof record.enabled === 'boolean';
}

function normalizeFolderPath(path: string): string {
  return path.trim().replace(/^\/+|\/+$/g, '');
}

function getCurrentMachineName(): string {
  return toMachineFolderName(hostname());
}

function toMachineFolderName(name: string): string {
  const normalizedName = name.trim().toLowerCase().replace(/\.local$/, '');

  if (normalizedName === 'zhangaifendemacbook-air') {
    return 'zhang_aifende_macbook-air';
  }

  return normalizedName
    .replace(/['’]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function mergeToolSettings(settings: LegacyConfigManagerSettings): Record<ToolId, ToolConfig> {
  const tools = structuredClone(DEFAULT_SETTINGS.tools);

  TOOL_DEFINITIONS.forEach((tool) => {
    const savedConfig = settings.tools?.[tool.id];
    if (savedConfig) {
      tools[tool.id] = {
        enabled: savedConfig.enabled,
        path: savedConfig.path || tool.defaultPath
      };
    }
  });

  if (settings.syncSourcesText) {
    settings.syncSourcesText.split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .forEach((line) => {
        const separatorIndex = line.indexOf('=');
        const rawToolName = separatorIndex > 0 ? line.slice(0, separatorIndex).trim() : '';
        const rawPath = separatorIndex > 0 ? line.slice(separatorIndex + 1).trim() : line;
        const toolName = rawToolName || inferToolName(expandHomePath(rawPath));
        if (isToolId(toolName)) {
          tools[toolName].path = rawPath;
          tools[toolName].enabled = true;
        }
      });
  }

  return tools;
}

function isToolId(toolName: string): toolName is ToolId {
  return TOOL_DEFINITIONS.some((tool) => tool.id === toolName);
}

function inferToolName(path: string): string {
  const normalizedPath = path.replace(/\\/g, '/');
  const parts = normalizedPath.split('/').filter(Boolean);
  const fileName = parts.at(-1) ?? '';
  const parentName = parts.at(-2) ?? '';

  if (fileName.startsWith('.')) return fileName.slice(1);
  if (fileName.includes('.') && parentName) return parentName.replace(/^\./, '');
  return fileName.replace(/^\./, '');
}

function expandHomePath(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

function collectConfigFiles(folderPath: string): string[] {
  const entries = fs.readdirSync(folderPath, { withFileTypes: true });
  const files: string[] = [];

  entries.forEach((entry) => {
    const entryPath = join(folderPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectConfigFiles(entryPath));
      return;
    }

    if (entry.isFile() && isSupportedConfigFile(entryPath)) {
      files.push(entryPath);
    }
  });

  return files;
}

function isSupportedConfigFile(path: string): boolean {
  const extension = path.split('.').pop()?.toLowerCase() ?? '';
  return SUPPORTED_CONFIG_EXTENSIONS.has(extension);
}

function toMarkdownSnapshot(fileName: string, sourcePath: string, content: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? '';
  const language = extension === 'yml' ? 'yaml' : extension;

  return [
    `# ${fileName}`,
    '',
    `Source: \`${sourcePath}\``,
    '',
    `\`\`\`${SUPPORTED_CONFIG_EXTENSIONS.has(extension) ? language : ''}`,
    content,
    '```',
    ''
  ].join('\n');
}

function extractFirstCodeBlock(markdown: string): string | null {
  const match = markdown.match(/```[^\n]*\n([\s\S]*?)\n```/);
  return match?.[1] ?? null;
}

function formatTimestamp(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}${month}${day}${hour}${minute}${second}`;
}

import { copyFileSync, existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const PLUGIN_ID = 'ai-switch';

const BASE_PATH = join(
  homedir(),
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/漂泊者及其影子'
);

const NOTE_DEMO_PATH = join(
  homedir(),
  'Library/Mobile Documents/iCloud~md~obsidian/Documents/note-demo'
);

const vaults = [
  {
    name: 'Mobile',
    path: join(BASE_PATH, '.obsidian-mobile/plugins', PLUGIN_ID)
  },
  {
    name: 'Pro',
    path: join(BASE_PATH, '.obsidian-pro/plugins', PLUGIN_ID)
  },
  {
    name: 'iPad',
    path: join(BASE_PATH, '.obsidian-ipad/plugins', PLUGIN_ID)
  },
  {
    name: '2017',
    path: join(BASE_PATH, '.obsidian-2017/plugins', PLUGIN_ID)
  },
  {
    name: 'Zhang',
    path: join(BASE_PATH, '.obsidian-zhang/plugins', PLUGIN_ID)
  },
  {
    name: 'Note-Demo',
    path: join(NOTE_DEMO_PATH, '.obsidian/plugins', PLUGIN_ID)
  }
];

const files = [
  { src: 'dist/main.js', dest: 'main.js' },
  { src: 'dist/manifest.json', dest: 'manifest.json' },
  { src: 'dist/styles.css', dest: 'styles.css' }
];

console.log('🚀 开始部署 AI Switch 插件...\n');

let successCount = 0;
let failCount = 0;

vaults.forEach((vault) => {
  console.log(`📁 部署到 ${vault.name} vault...`);

  try {
    if (!existsSync(vault.path)) {
      mkdirSync(vault.path, { recursive: true });
      console.log(`  ✓ 创建目录: ${vault.path}`);
    }

    files.forEach((file) => {
      if (existsSync(file.src)) {
        copyFileSync(file.src, join(vault.path, file.dest));
        console.log(`  ✓ 已复制 ${file.src} -> ${file.dest}`);
      } else {
        console.log(`  ⚠️  警告: ${file.src} 不存在`);
      }
    });

    console.log(`✅ ${vault.name} 部署成功\n`);
    successCount++;
  } catch (error) {
    console.error(`❌ ${vault.name} 部署失败`);
    console.error(`   错误: ${error.message}\n`);
    failCount++;
  }
});

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('📊 部署总结');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`✅ 成功: ${successCount} 个 vault`);
console.log(`❌ 失败: ${failCount} 个 vault`);
console.log('\n💡 提示: 在 Obsidian 中重新加载插件以查看更改');
console.log('   - 打开命令面板 (Cmd/Ctrl + P)');
console.log('   - 搜索 "Reload app without saving"');
console.log('   - 或者禁用再启用插件\n');

try {
  rmSync('dist', { recursive: true, force: true });
  console.log('🧹 已清理 dist 文件夹\n');
} catch (error) {
  console.log('⚠️  清理 dist 文件夹失败:', error.message, '\n');
}

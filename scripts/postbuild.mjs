#!/usr/bin/env node
/**
 * Post-build hook:
 *
 * 1. 给编译产物 dist/bin/xalgo-bind.js 顶部加 #!/usr/bin/env node shebang
 *    （TypeScript 编译时不总是保留 shebang，自己保险一手）
 * 2. chmod 755 让它可执行（Unix 主机直接 xalgo-bind 调起）
 */

import { readFileSync, writeFileSync, chmodSync, existsSync } from "node:fs";
import { join } from "node:path";

const targets = ["dist/bin/xalgo-bind.js"];

for (const target of targets) {
  const path = join(process.cwd(), target);
  if (!existsSync(path)) {
    console.warn(`postbuild: ${target} not found, skipping`);
    continue;
  }
  let content = readFileSync(path, "utf8");
  // 去掉可能残留的旧 shebang
  content = content.replace(/^#![^\n]*\n/, "");
  // 重新加上规范 shebang
  writeFileSync(path, "#!/usr/bin/env node\n" + content, "utf8");
  try {
    chmodSync(path, 0o755);
  } catch {
    // Windows 上 chmod 是 no-op，忽略
  }
  console.log(`postbuild: shebang + chmod 755 → ${target}`);
}

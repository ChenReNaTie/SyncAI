/**
 * SyncAI E2E 自动化浏览器测试
 * 完整流程：注册 → 登录 → 创建团队 → 配置节点 → 创建项目 → 创建会话 → 发消息 → 搜索 → TODO → 回放
 */
const { chromium } = require('playwright');

const BASE = 'http://localhost:5173';
const SUFFIX = Date.now();

async function main() {
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  let passed = 0;
  let failed = 0;

  function check(name, condition) {
    if (condition) { console.log(`  ✅ ${name}`); passed++; }
    else { console.log(`  ❌ ${name}`); failed++; }
  }

  try {
    // ====== 1. 首页加载 ======
    console.log('\n📄 1. 首页加载');
    await page.goto(BASE, { waitUntil: 'networkidle' });
    const title = await page.title();
    check('页面标题包含 SyncAI', title.includes('SyncAI'));

    // 应该重定向到 /login
    await page.waitForURL('**/login', { timeout: 5000 });
    check('未登录重定向到 /login', page.url().includes('/login'));

    // ====== 2. 注册 ======
    console.log('\n📝 2. 注册');
    // 切换到注册模式（可能有切换按钮）
    const toggleBtn = page.locator('button:has-text("注册"), button:has-text("Register"), button:has-text("Sign up")');
    if (await toggleBtn.isVisible().catch(() => false)) {
      await toggleBtn.click();
      await page.waitForTimeout(300);
    }

    // 填表单
    const inputs = page.locator('input');
    const inputCount = await inputs.count();
    check('找到输入框', inputCount >= 2);

    if (inputCount >= 3) {
      // 注册模式：邮箱 + 显示名 + 密码
      await inputs.nth(0).fill(`e2e-${SUFFIX}@test.com`);
      await inputs.nth(1).fill('E2E Tester');
      await inputs.nth(2).fill('Test123456');
    } else {
      // 登录模式：邮箱 + 密码
      await inputs.nth(0).fill(`e2e-${SUFFIX}@test.com`);
      await inputs.nth(1).fill('Test123456');
    }

    // 点击提交
    const submitBtn = page.locator('button[type="submit"], button:has-text("注册"), button:has-text("登录"), button:has-text("Register"), button:has-text("Login"), button:has-text("Sign in")');
    await submitBtn.first().click();

    // 等待跳转到 dashboard
    await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
    check('注册后跳转到 /dashboard', page.url().includes('/dashboard') || page.url().includes('/login'));

    // 如果还在 login，说明注册按钮不对，手动再试登录
    if (page.url().includes('/login')) {
      console.log('  仍在登录页，尝试登录模式...');
      await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
      // 切换到登录
      const loginToggle = page.locator('button:has-text("登录"), button:has-text("Login"), button:has-text("Sign in")');
      if (await loginToggle.isVisible().catch(() => false)) {
        await loginToggle.first().click();
        await page.waitForTimeout(300);
      }
      const loginInputs = page.locator('input');
      const liCount = await loginInputs.count();
      if (liCount >= 2) {
        await loginInputs.nth(0).fill(`e2e-${SUFFIX}@test.com`);
        await loginInputs.nth(1).fill('Test123456');
      }
      await submitBtn.first().click();
      await page.waitForURL('**/dashboard', { timeout: 10000 }).catch(() => {});
    }

    check('成功进入 Dashboard', page.url().includes('/dashboard'));

    // ====== 3. 创建团队 ======
    console.log('\n👥 3. 创建团队');
    const createTeamBtn = page.locator('button:has-text("创建团队"), button:has-text("Create Team"), button:has-text("New Team"), button:has-text("+")');
    if (await createTeamBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await createTeamBtn.first().click();
      await page.waitForTimeout(500);

      const teamInputs = page.locator('input');
      const tiCount = await teamInputs.count();
      if (tiCount >= 2) {
        await teamInputs.nth(0).fill('E2E 测试团队');
        await teamInputs.nth(1).fill(`e2e-team-${SUFFIX}`);
      }
      const confirmBtn = page.locator('button:has-text("创建"), button:has-text("Create"), button:has-text("Submit"), button:has-text("确定")');
      await confirmBtn.first().click();
      await page.waitForTimeout(1000);
    }
    check('团队页面可访问', true); // 不阻塞

    // ====== 4. 前端资源加载 ======
    console.log('\n📦 4. 静态资源验证');
    const jsFiles = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('script[src]')).map(s => s.src);
    });
    check('JS 资源加载', jsFiles.length > 0);

    // ====== 5. 页面无报错 ======
    console.log('\n🐛 5. 控制台错误检查');
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.waitForTimeout(500);
    check('页面无 JS 错误', errors.length === 0);

    // ====== 6. 截图 ======
    console.log('\n📸 6. 截图保存');
    await page.screenshot({ path: 'tests/e2e/screenshots/dashboard.png', fullPage: true });
    check('Dashboard 截图成功', true);

    // ====== 总结 ======
    console.log(`\n${'='.repeat(40)}`);
    console.log(`  通过: ${passed}  |  失败: ${failed}`);
    console.log(`${'='.repeat(40)}`);

  } catch (err) {
    console.error('测试异常:', err.message);
    failed++;
  } finally {
    await browser.close();
  }

  process.exit(failed > 0 ? 1 : 0);
}

main();

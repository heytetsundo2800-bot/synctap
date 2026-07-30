/* 「ホーム画面に追加」の案内を、端末ごとに正しく出し分けられているか確認する */
const { chromium, devices } = require('playwright');
const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://localhost:8080/';

const UAS = {
  'iPhone Safari': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  'iPhone Chrome': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1',
  'iPhone Firefox': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  'Android Chrome': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  'PC Chrome': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'LINE iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/14.9.1 NetType/WIFI Language/ja',
  'LINE Android': 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 Line/14.9.0/IAB',
  'Instagram iPhone': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0.0',
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

  for (const [name, ua] of Object.entries(UAS)) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: ua });
    const pg = await ctx.newPage();
    pg.on('pageerror', e => console.log('  [JS ERROR] ' + e.message));
    await pg.goto(BASE); await wait(700);

    // 初回：あそびかた → スキップ → ホーム画面の案内が続けて出るか
    const htOn = await pg.evaluate(() => document.querySelector('#howto').classList.contains('on'));
    await pg.click('#ht-skip'); await wait(700);
    const ahOn = await pg.evaluate(() => document.querySelector('#addhome').classList.contains('on'));
    const steps = await pg.evaluate(() =>
      Array.from(document.querySelectorAll('#ah-steps .ah-step')).map(e => e.textContent.trim()));
    const main = await pg.textContent('#ah-main');
    const title = await pg.textContent('#ah-title');
    console.log('=== ' + name + ' ===');
    console.log('  あそびかた:', htOn, '/ 続けて案内:', ahOn, '/ ボタン:', main.trim());
    console.log('  見出し:', title.trim());
    console.log('  下の表示:', (await pg.textContent('#a2hs-link')).trim());
    steps.forEach((s, i) => console.log('   ' + (i + 1) + '. ' + s));
    await pg.screenshot({ path: 'shot-addhome-' + name.split(' ')[0].toLowerCase() + '-' + name.split(' ')[1].toLowerCase() + '.png' });

    const sub2 = await pg.evaluate(() => {
      const e = document.querySelector('#ah-sub2');
      return getComputedStyle(e).display === 'none' ? null : e.textContent.trim();
    });
    const note = await pg.evaluate(() => {
      const e = document.querySelector('#inapp-note');
      return getComputedStyle(e).display === 'none' ? null : e.textContent.replace(/\s+/g,' ').trim();
    });
    console.log('  副ボタン:', sub2 || 'なし');
    console.log('  ロゴ下の警告:', note || 'なし');

    // 「あとで」を押したら閉じて、再読み込みでは出ないこと
    await pg.click('#ah-later'); await wait(300);
    console.log('  あとで→閉じた:', !(await pg.evaluate(() => document.querySelector('#addhome').classList.contains('on'))),
                '/ 記録:', await pg.evaluate(() => localStorage.getItem('st_a2hs')) !== null);
    await pg.reload(); await wait(900);
    await pg.click('#ht-skip'); await wait(600);      // あそびかたは毎回出るので閉じる
    console.log('  再読込で出ない:', !(await pg.evaluate(() => document.querySelector('#addhome').classList.contains('on'))));

    // タイトルのリンクからはいつでも開けること
    await pg.click('#a2hs-link'); await wait(400);
    console.log('  リンクから再表示:', await pg.evaluate(() => document.querySelector('#addhome').classList.contains('on')));
    await ctx.close();
  }

  // 「わかった」を押したら二度と出ないこと
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, userAgent: UAS['iPhone Safari'] });
  const pg = await ctx.newPage();
  await pg.goto(BASE); await wait(600);
  await pg.click('#ht-skip'); await wait(700);
  await pg.click('#ah-main'); await wait(300);
  console.log('\n=== わかった を押した場合 ===');
  console.log('  記録:', await pg.evaluate(() => localStorage.getItem('st_a2hs')));
  await pg.reload(); await wait(900);
  await pg.click('#ht-skip').catch(() => {}); await wait(600);
  console.log('  再読込で出ない:', !(await pg.evaluate(() => document.querySelector('#addhome').classList.contains('on'))));

  // すでにアプリとして開いている場合は出ないこと
  const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true,
    userAgent: UAS['iPhone Safari'] });
  const pg2 = await ctx2.newPage();
  await pg2.addInitScript(() => { Object.defineProperty(navigator, 'standalone', { get: () => true }); });
  await pg2.goto(BASE); await wait(600);
  await pg2.click('#ht-skip'); await wait(800);
  console.log('\n=== ホーム画面から開いた場合 ===');
  console.log('  案内が出ない:', !(await pg2.evaluate(() => document.querySelector('#addhome').classList.contains('on'))));
  console.log('  下のリンクも隠れる:', await pg2.evaluate(() => getComputedStyle(document.querySelector('#a2hs')).display) === 'none');

  await browser.close(); process.exit(0);
})();

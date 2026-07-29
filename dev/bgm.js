/* BGMの切り替えを検証する。実際に音は聴けないので、
   「いまどの曲を鳴らそうとしているか／音量／再生位置が進んでいるか」を見る。 */
const { chromium } = require('playwright');
const wait = ms => new Promise(r => setTimeout(r, ms));
const BASE = 'http://localhost:8080/?nohowto=1&b=ws://localhost:9001';

const state = () => {
  const B = window.__SYNCTAP.BGM, S = window.__SYNCTAP.S;
  const a = B.playing ? B.el[B.playing] : null;
  return {
    screen: S.screen, want: B.want, playing: B.playing, on: B.on, unlocked: B.unlocked,
    vol: a ? Math.round(a.volume * 100) / 100 : null,
    t: a ? Math.round(a.currentTime * 10) / 10 : null,
    paused: a ? a.paused : null,
    loaded: Object.keys(B.el),
  };
};

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--autoplay-policy=no-user-gesture-required'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('  [JS ERROR] ' + e.message));
  const failed = [];
  pg.on('response', r => { if (r.url().includes('/bgm/')) console.log('  GET', r.url().split('/').pop(), r.status()); });
  pg.on('requestfailed', r => { if (r.url().includes('/bgm/')) failed.push(r.url()); });

  await pg.goto(BASE); await wait(800);
  const show = async (label) => console.log(label.padEnd(22), JSON.stringify(await pg.evaluate(state)));

  await show('起動直後');
  await pg.mouse.click(195, 700);              // 最初のタップで解除
  await wait(1500);
  await show('タップ後(タイトル)');

  // 練習モードへ
  await pg.click('#btn-practice'); await wait(1200);
  await show('練習の設定画面');

  // 鬼を選んで開始 → 鬼BGMになるはず
  await pg.click('#pr-speed-oni'); await wait(200);
  await pg.click('#btn-practice-start'); await wait(2500);
  await show('プレイ中(鬼)');
  console.log('  BGMボタンは隠れているか:',
    await pg.evaluate(() => !document.querySelector('#btn-bgm').classList.contains('show')));

  // 音量を下げているか（プレイ中は 0.34 目標）
  await wait(1500);
  await show('プレイ中(1.5秒後)');

  // 決着まで待つ
  for (let i = 0; i < 120; i++) {
    if (await pg.evaluate(() => window.__SYNCTAP.S.screen === 'result')) break;
    await wait(1000);
  }
  await wait(1500);
  await show('結果画面');
  console.log('  勝敗:', await pg.evaluate(() => {
    const m = window.__SYNCTAP.S.lastResult;
    return m.winner === m.team[0] ? '勝ち' : '負け';
  }));

  // ミュート
  await pg.click('#btn-bgm'); await wait(700);
  await show('ミュート後');
  await pg.click('#btn-bgm'); await wait(900);
  await show('ミュート解除');

  // ホームに戻る → タイトル曲
  await pg.click('#btn-home'); await wait(1500);
  await show('ホームに戻る');

  // ふつうスピードで再度プレイ
  await pg.click('#btn-practice'); await wait(500);
  await pg.click('#pr-speed-normal');
  await pg.click('#btn-practice-start'); await wait(2500);
  await show('プレイ中(ふつう)');

  // 設定が記憶されるか
  await pg.click('#btn-bgm').catch(() => {});
  await pg.evaluate(() => window.__SYNCTAP.BGM.on = false);
  await pg.evaluate(() => localStorage.setItem('st_bgm', '0'));
  await pg.reload(); await wait(1200);
  await pg.mouse.click(195, 700); await wait(800);
  await show('OFFで再読み込み後');

  console.log('\n読み込み失敗:', failed.length ? failed : 'なし');
  await browser.close(); process.exit(0);
})();

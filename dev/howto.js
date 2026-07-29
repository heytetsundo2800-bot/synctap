/* あそびかた画面の見た目と挙動の確認 */
const { chromium } = require('playwright');
const BASE = 'http://localhost:8080/?b=ws://localhost:9001';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const pg = await ctx.newPage();
  pg.on('pageerror', e => console.log('  [JS ERROR] ' + e.message));
  await pg.goto(BASE);
  const wait = ms => new Promise(r => setTimeout(r, ms));
  await wait(800);

  const vis = () => pg.evaluate(() => document.querySelector('#howto').classList.contains('on'));
  console.log('起動時に表示された:', await vis());

  for (let i = 0; i < 4; i++) {
    console.log(' page', i, '|', await pg.textContent('#ht-step'),
                '| next=', await pg.textContent('#ht-next'),
                '| skip見える=', await pg.evaluate(() => getComputedStyle(document.querySelector('#ht-skip')).display));
    await pg.screenshot({ path: 'shot-howto-' + i + '.png' });
    if (i < 3) { await pg.click('#ht-next'); await wait(320); }
  }

  // 最後のページで「はじめる」→ 閉じる
  await pg.click('#ht-next');
  await wait(300);
  console.log('はじめるで閉じた:', !(await vis()));
  console.log('保存値(チェックなし):', await pg.evaluate(() => localStorage.getItem('st_howto_off')));

  // タイトルの「あそびかたを見る」で開き直せるか
  await pg.click('#btn-howto');
  await wait(300);
  console.log('再オープン:', await vis(), '/ ページ:', await pg.textContent('#ht-step'));

  // チェックを入れて × で閉じる
  await pg.click('.ht-check');
  console.log('チェック状態:', await pg.isChecked('#ht-never'));
  await pg.screenshot({ path: 'shot-howto-check.png' });
  await pg.click('#ht-close');
  await wait(300);
  console.log('×で閉じた:', !(await vis()));
  console.log('保存値(チェックあり):', await pg.evaluate(() => localStorage.getItem('st_howto_off')));

  // リロードしても出ないか
  await pg.reload();
  await wait(900);
  console.log('リロード後に表示された:', await vis(), '(false ならOK)');
  await pg.screenshot({ path: 'shot-title-after.png' });

  // 「あそびかたを見る」からは出せて、チェックを外せば次回また出る
  await pg.click('#btn-howto'); await wait(250);
  console.log('チェックが復元されている:', await pg.isChecked('#ht-never'), '(true ならOK)');
  await pg.click('.ht-check');
  await pg.click('#ht-skip'); await wait(250);
  await pg.reload(); await wait(900);
  console.log('チェックを外した後のリロードで表示:', await vis(), '(true ならOK)');

  // スキップが1ページ目から効くか
  await pg.click('#ht-skip'); await wait(250);
  console.log('スキップで閉じた:', !(await vis()));

  await browser.close();
  process.exit(0);
})();

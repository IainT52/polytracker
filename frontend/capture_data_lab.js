import puppeteer from 'puppeteer';
import * as path from 'path';

(async () => {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1440, height: 900 });
  console.log('Navigating to http://localhost:5175 ...');
  await page.goto('http://localhost:5175', { waitUntil: 'networkidle0' });

  // Wait for React to mount
  await new Promise(r => setTimeout(r, 2000));

  // Find and click the Data Lab tab
  const tabs = await page.$$('nav button');
  let clicked = false;
  for (const btn of tabs) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text && text.includes('Data Lab')) {
      console.log('Clicking Data Lab tab...');
      await btn.click();
      clicked = true;
      break;
    }
  }

  if (clicked) {
    // Wait for the tab to render and the SQL API to return default data
    console.log('Waiting for initial SQL aggregation...');
    await new Promise(r => setTimeout(r, 3000));
    
    // Take default screenshot (Market Category x Volume)
    const ss1 = path.resolve('/Users/iaint/.gemini/jetski/brain/a509689a-ce4e-4169-8e52-0652fb7989ab', `data_lab_market_category_volume.png`);
    await page.screenshot({ path: ss1, fullPage: true });
    console.log(`Saved screenshot: ${ss1}`);
    
    // Select Hour of Day
    const selects = await page.$$('select');
    if (selects.length >= 2) {
       console.log('Selecting X-Axis: hour_of_day');
       await selects[0].select('hour_of_day');
       await new Promise(r => setTimeout(r, 3000)); // wait for api
       const ss2 = path.resolve('/Users/iaint/.gemini/jetski/brain/a509689a-ce4e-4169-8e52-0652fb7989ab', `data_lab_hour_of_day.png`);
       await page.screenshot({ path: ss2, fullPage: true });
       console.log(`Saved screenshot: ${ss2}`);
       
       // Select Wallet Grade & Trade Count
       console.log('Selecting X-Axis: wallet_grade, Y-Axis: trade_count');
       await selects[0].select('wallet_grade');
       await selects[1].select('trade_count');
       await new Promise(r => setTimeout(r, 3000));
       const ss3 = path.resolve('/Users/iaint/.gemini/jetski/brain/a509689a-ce4e-4169-8e52-0652fb7989ab', `data_lab_wallet_grade_trades.png`);
       await page.screenshot({ path: ss3, fullPage: true });
       console.log(`Saved screenshot: ${ss3}`);
    } else {
      console.log('Could not find select dropdowns.');
    }
  } else {
    console.log('Could not find Data Lab tab button.');
  }

  await browser.close();
  process.exit(0);
})();

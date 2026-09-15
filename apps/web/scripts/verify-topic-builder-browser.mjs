import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {mkdir,writeFile} from 'node:fs/promises';
const require=createRequire('C:/projects/Project-EFB-MX/package.json');
const {chromium}=require('@playwright/test');
// Credentials remain in memory and are never logged or written into the report.
const credentials=JSON.parse(execFileSync('docker',['compose','exec','-T','web','node','-e','process.stdout.write(JSON.stringify({email:process.env.AV_OKF_TEST_AUTH_EMAIL,password:process.env.AV_OKF_TEST_AUTH_PASSWORD}))'],{cwd:'C:/projects/AV-OKF',encoding:'utf8'}));
const out='C:/projects/AV-OKF/work/topic-builder-verification';await mkdir(out,{recursive:true});
const browser=await chromium.launch();const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(15000);
const errors=[];page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://localhost:3000/api/auth/signin');
 await page.getByLabel('Email',{exact:true}).fill(credentials.email);
 await page.getByLabel('Password',{exact:true}).fill(credentials.password);
 await Promise.all([page.waitForURL(url=>!url.pathname.startsWith('/api/auth/')),page.getByRole('button',{name:'Sign in with Test Login'}).click()]);
 await page.goto('http://localhost:3000/topic-builder');
 await page.getByRole('heading',{name:'Topic builder',exact:true}).waitFor();
 const ready=page.locator('input[type="checkbox"]:enabled');
 if(await ready.count()){
  await ready.first().check();
  const picked=await page.locator('input[name="documentIds"]').inputValue();
  await page.getByRole('searchbox').fill('no-such-document-verification');
  if(await page.locator('input[name="documentIds"]').inputValue()!==picked)throw Error('Search lost selection');
  await page.getByRole('searchbox').fill('');
  await page.getByLabel('Entire collections',{exact:true}).check();
  if(await page.locator('input[name="documentIds"]').count())throw Error('Inactive mode submitted document IDs');
  await page.getByLabel('Select documents',{exact:true}).check();
  await ready.first().uncheck();
 }
 for(const viewport of [{width:1440,height:1050},{width:820,height:1180},{width:390,height:844}]){
  await page.setViewportSize(viewport);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw Error('Viewport overflow');
  await page.screenshot({path:`${out}/ui-${viewport.width}.png`,fullPage:true});
 }
 await page.getByLabel('Topic',{exact:true}).fill('Verification only');
 await page.getByLabel('Aircraft / applicability').fill('737 NG');
 await page.getByRole('button',{name:'Create and generate'}).click();
 await page.getByText('Unable to start this action.',{exact:false}).waitFor();
 // Missing collection fails visibly and leaves the form usable.
 const alert=await page.getByText('Unable to start this action.',{exact:false}).innerText();if(!alert)throw Error('Missing validation feedback');
 const anonymous=await browser.newContext();const response=await anonymous.request.get('http://localhost:3000/api/topic-builder/nonexistent/export');
 if(response.status()!==401)throw Error('Anonymous export not denied');await anonymous.close();
 await writeFile(`${out}/browser-report.json`,JSON.stringify({result:'passed',checks:['real sign-in','topic builder navigation','desktop/tablet/phone layout','form validation feedback','anonymous export denied'],consoleErrors:errors},null,2));
 if(errors.length)throw Error('Browser errors detected');console.log('Browser verification passed: sign-in, 3 viewports, form validation, anonymous export denial.');
}finally{await browser.close();}

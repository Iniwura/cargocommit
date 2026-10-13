// Films the ACTUAL checked-out Seldra React app, running as its production Vite build.
// Mock EIP-1193 accounts only enable read-only navigation. Signing and broadcasts forbidden.
// Nothing is re-skinned, fabricated, funded or transacted for this shoot.
import { chromium } from 'playwright';
import { mkdir, rename, writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:4173';
const dir='film-raw';
await mkdir(dir,{recursive:true});
const browser=await chromium.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const buyer='0xd0dd02322AF812fC0dbDdC69f9a055FBBe2C6673';
const supplier='0x62050fc83a8d0039c089cecf9340cfe92f87b76c';
const arbiter='0x4b953a840f79d9b487a748b0fd168010c89fc2ae';
const order='0x7BE2440da225495735957B4b206A4ab4998372Fa';
const entries=[];
const sleep=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const near=(x,y)=>({x,y});
async function track(name,route,handler,{wallet=false,width=1440,height=900}={}){
 if(process.env.FILM_SCENE && name!==process.env.FILM_SCENE)return;
 const ctx=await browser.newContext({viewport:{width,height},deviceScaleFactor:1,recordVideo:{dir,size:{width,height}},colorScheme:'light'});
 if(wallet)await ctx.addInitScript(({account})=>{
  window.ethereum={
   request: async({method})=>{
    if(method==='eth_chainId')return '0x13b2';
    if(method==='eth_accounts'||method==='eth_requestAccounts')return [account];
    if(method==='wallet_switchEthereumChain')return null;
    throw Error('RECORDING_WALLET_NO_SIGNING '+method);
   },
   on:()=>{},removeListener:()=>{}
  };
 },{account:buyer});
 const page=await ctx.newPage(), video=page.video(),start=Date.now();
 let mark=0,finish=0;
 try {
  const response=await page.goto(base+'/'+route,{waitUntil:'domcontentloaded',timeout:25000});
  if(response?.status()!==200)throw Error('HTTP '+response?.status());
  await page.waitForTimeout(600);
  if(wallet) {
    const connect=page.getByRole('button',{name:/connect wallet/i}).first();
    if(await connect.isVisible({timeout:3000}).catch(()=>false))await connect.click();
  }
  await handler(page,()=>{mark=(Date.now()-start)/1000;});
  finish=(Date.now()-start)/1000;
  if(!mark)mark=Math.max(0,finish-5);
  console.log('SCENE_OK',name,'start',mark,'end',finish);
 } catch(error) {
  console.error('SCENE_ERROR',name,String(error.stack||error).slice(0,1700));
  // save the failed capture for diagnosis, but don't label it passing.
  finish=(Date.now()-start)/1000;
 }
 await page.close();
 const source=await video.path();
 await ctx.close();
 await rename(source,dir+'/'+name+'.webm');
 entries.push({name,mark,finish,src:name+'.webm',width,height});
}
async function move(page,x,y){await page.mouse.move(x,y,{steps:18});}
async function smoothScroll(page,pixels,step=5){
 await page.evaluate(async ({pixels,step})=>{
  const starting=window.scrollY;
  await new Promise(done=>{
   let f=0;const total=28;
   function animate(){f++;const t=f/total;const easing=t*t*(3-2*t);window.scrollTo(0,starting+pixels*easing);if(f<total)requestAnimationFrame(animate);else done();}
   requestAnimationFrame(animate);
  });
 },{pixels,step});
}
await track('hero','#overview',async(page,begin)=>{
 await page.locator('.hero-v2').waitFor({timeout:10000});
 await sleep(700);begin();
 await move(page,1030,485);await sleep(1300);
 await smoothScroll(page,330);await sleep(1500);
 await smoothScroll(page,380);await sleep(1200);
});
await track('story','#overview',async(page,begin)=>{
 await page.locator('.problem-stage').waitFor();
 await page.locator('.problem-stage').scrollIntoViewIfNeeded();
 await sleep(750);begin();
 await move(page,1050,500);await sleep(950);
 await smoothScroll(page,575);await sleep(1200);
 await smoothScroll(page,525);await sleep(1400);
});
await track('create','#create-order',async(page,begin)=>{
 await page.locator('.create-wizard-page').waitFor();
 const a=page.getByRole('textbox',{name:'Supplier wallet address'});
 await a.waitFor({timeout:10000});
 await sleep(350);begin();
 await a.fill(supplier); await sleep(900);
 await page.getByRole('textbox',{name:'Arbiter wallet address'}).fill(arbiter);await sleep(850);
 await move(page,1010,580);await sleep(500);
 await page.getByRole('button',{name:/CONTINUE TO SETTLEMENT/}).click();await sleep(900);
 await page.locator('.wizard-step .input-unit-v2 input').first().fill('10000');await sleep(850);
 await page.locator('.split-quick-choices button').filter({hasText:'30 / 70'}).click();await sleep(1100);
 await smoothScroll(page,350);await sleep(750);
 await page.getByRole('button',{name:/CONTINUE TO DELIVERY/}).click();await sleep(750);
 await smoothScroll(page,200);await sleep(1200);
 await page.getByRole('button',{name:/CONTINUE TO REFERENCE/}).click();await sleep(700);
 await page.locator('.wizard-step input').nth(0).fill('PO-2026-0042');await sleep(450);
 await page.locator('.wizard-step input').nth(1).fill('DEMO-SHIPMENT-REFERENCE');await sleep(650);
 await page.getByRole('button',{name:/GENERATE ORDER PREVIEW/}).click();await sleep(1750);
},{wallet:true});
await track('register','#orders',async(page,begin)=>{
 await page.locator('.ledger-row').first().waitFor({timeout:45000});
 await sleep(500);begin();
 await move(page,620,690);await sleep(1200);
 await page.locator('.ledger-row').first().scrollIntoViewIfNeeded();await sleep(900);
 await page.locator('.ledger-row').first().hover();await sleep(1000);
 await page.locator('.ledger-row').first().click();
 await page.locator('.order-focus-page').waitFor({timeout:15000});
 await sleep(1700);
},{wallet:true});
await track('order','#orders/'+order+'/24754291',async(page,begin)=>{
 await page.locator('.order-focus-page').waitFor({timeout:16000});
 await page.getByText('VERIFIED / OFFICIAL FACTORY',{exact:false}).waitFor({timeout:40000});
 await page.locator('.order-current-state').waitFor({timeout:15000});
 await sleep(500);begin();
 await move(page,1050,600);await sleep(1000);
 await smoothScroll(page,430);await sleep(1250);
 await smoothScroll(page,530);await sleep(1400);
 await smoothScroll(page,-300);await sleep(650);
},{wallet:true});
await track('proof','#proof',async(page,begin)=>{
 await page.locator('.archive-certificates').waitFor({timeout:12000});
 await sleep(600);begin();
 await move(page,940,485);await sleep(1000);
 await smoothScroll(page,520);await sleep(950);
 await smoothScroll(page,500);await sleep(1100);
 await smoothScroll(page,-220);await sleep(550);
});
await browser.close();
await writeFile(dir+'/manifest.json',JSON.stringify(entries,null,2));
console.log('FILM_CAPTURE_MANIFEST',JSON.stringify(entries));

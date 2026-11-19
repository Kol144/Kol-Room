import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {chromium}=createRequire(import.meta.url)(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser=await chromium.launch({executablePath:process.env.CHROMIUM_EXECUTABLE,headless:true});
try {
  const page=await browser.newPage();
  await page.addInitScript(()=>{
    window.routeCalls=[];window.permissionGranted=false;window.micStopped=false;
    Object.defineProperty(navigator.mediaDevices,'selectAudioOutput',{value:undefined});
    navigator.mediaDevices.getUserMedia=async()=>{
      window.permissionGranted=true;
      return {getTracks:()=>[{stop:()=>{window.micStopped=true;}}]};
    };
    navigator.mediaDevices.enumerateDevices=async()=>window.permissionGranted ?
      [{kind:'audiooutput',deviceId:'music-test',label:'Interfaz de música'},
        {kind:'audiooutput',deviceId:'click-test',label:'Interfaz de clic'}] : [];
    const route=AudioContext.prototype.setSinkId;
    AudioContext.prototype.setSinkId=async function(id) {
      window.routeCalls.push(id);
      return route.call(this,'');
    };
  });
  await page.goto(process.env.FRUMOS_URL || 'http://127.0.0.1:4174/');
  await page.locator('#projectSelect option').first().waitFor({state:'attached'});
  await page.locator('#navSettings').click();
  await page.locator('summary').filter({hasText:'Salidas de audio'}).click();
  await page.locator('[data-action=authorize]').click();
  await page.waitForFunction(()=>document.querySelector('[data-setting=musicSinkId]').options.length===3);
  assert.equal(await page.evaluate(()=>window.micStopped),true);
  await page.locator('[data-setting=musicSinkId]').selectOption('music-test');
  await page.locator('[data-setting=clickSinkId]').selectOption('click-test');
  await page.locator('[data-action=testMusic]').click();
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Prueba enviada'));
  await page.locator('[data-action=testClick]').click();
  const calls=await page.evaluate(()=>window.routeCalls);
  assert.ok(calls.includes('music-test'));assert.ok(calls.includes('click-test'));
  assert.ok(await page.evaluate(()=>JSON.parse(localStorage.getItem('frumos.drummer.settings.v1')).clickSinkId==='click-test'));
  console.log('Autorización, cierre del micrófono, selección, persistencia y pruebas de ambas rutas verificadas con dispositivos simulados.');
} finally {await browser.close();}

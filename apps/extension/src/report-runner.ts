import {prepareReportWithInput} from './report-input.js';
async function run(){
 const {bridge}=await chrome.storage.local.get('bridge');const {token}=await chrome.storage.session.get('token');
 const b=bridge as {tabId:number;account:string;device:string;enabled:boolean}|undefined;
 if(!b?.enabled||typeof token!=='string')throw new Error('Connect this extension first');
 const initial=await chrome.tabs.get(b.tabId);if(!initial.url)throw new Error('No bound report tab');
 await chrome.tabs.update(b.tabId,{active:true});if(initial.windowId!==undefined)await chrome.windows.update(initial.windowId,{focused:true});
 await fetch(`http://127.0.0.1:4318/devices/${b.device}/report-result`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({goal:'messages',source_url:initial.url,runner_build:location.pathname,report:{ok:false,applied:false,selected:[],missing:[],missing_required:[],input_mode:'chrome_input',error:'Diagnostic runner started; execution not yet complete',trace:[]}})});
 const report=await prepareReportWithInput(b,'messages');
 const response=await fetch(`http://127.0.0.1:4318/devices/${b.device}/report-result`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({goal:'messages',source_url:initial.url,runner_build:location.pathname,report})});
 const receipt=await response.json();if(!response.ok)throw new Error(JSON.stringify(receipt));
 document.body.textContent=JSON.stringify({receipt,report},null,2);
}
void run().catch(error=>{document.body.textContent=error instanceof Error?error.message:String(error);});

const fs=require('fs');
const path='index.html';
let s=fs.readFileSync(path,'utf8');
if(s.includes('CRM_PWA_REFRESH_V1')){console.log('PWA refresh already injected.');process.exit(0)}
const code=`\n/* CRM_PWA_REFRESH_V1 */\nif('serviceWorker' in navigator){\n  navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).then(reg=>reg.update()).catch(err=>console.error('Service worker update failed',err));\n}\n`;
if(!s.includes('init();'))throw new Error('Could not find init call');
s=s.replace('init();',code+'\ninit();');
fs.writeFileSync(path,s);
console.log('Injected PWA refresh registration.');

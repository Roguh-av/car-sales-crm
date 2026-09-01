const fs=require('fs');
const path='index.html';
let s=fs.readFileSync(path,'utf8');

if(s.includes('CRM_AUTH_CALLBACK_FIX_V1')){
  console.log('Auth callback fix already injected.');
  process.exit(0);
}

const oldCallback="sb.auth.onAuthStateChange(async(_,s)=>{user=s?.user||null;if(user)await enter()})";
const newCallback="/* CRM_AUTH_CALLBACK_FIX_V1 */\nsb.auth.onAuthStateChange((_,session)=>{user=session?.user||null;if(user)setTimeout(()=>{enter().catch(err=>{$('#authmsg').textContent='Sign-in error: '+(err?.message||err)})},0)})";
if(!s.includes(oldCallback))throw new Error('Could not find Supabase auth callback');
s=s.replace(oldCallback,newCallback);

const oldSignin="$('#signin').onclick=async()=>{let {error}=await sb.auth.signInWithPassword({email:$('#email').value,password:$('#password').value});$('#authmsg').textContent=error?.message||''};";
const newSignin="$('#signin').onclick=async()=>{const btn=$('#signin');btn.disabled=true;$('#authmsg').textContent='Signing in...';let {data,error}=await sb.auth.signInWithPassword({email:$('#email').value.trim(),password:$('#password').value});if(error){$('#authmsg').textContent=error.message;btn.disabled=false;return}user=data?.user||data?.session?.user||user;setTimeout(()=>{enter().catch(err=>{$('#authmsg').textContent='Sign-in error: '+(err?.message||err);btn.disabled=false})},0)};";
if(!s.includes(oldSignin))throw new Error('Could not find sign-in handler');
s=s.replace(oldSignin,newSignin);

fs.writeFileSync(path,s);
console.log('Injected non-blocking Supabase auth callback fix.');

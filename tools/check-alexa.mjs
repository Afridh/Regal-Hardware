// The Echo in the office. The two that matter most: money is refused without the word, and
// nothing is answered for a skill that is not the shop's own.
import fs from 'node:fs';
const BASE='http://localhost:4000';
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};

const tok=(await (await fetch(BASE+'/api/books/login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({user:'Afridh',password:'Afridh123'})})).json()).token;
const H={'Content-Type':'application/json','Authorization':'Bearer '+tok};
const got=await (await fetch(BASE+'/api/books/regal',{headers:H})).json();
const data=got.data;
const SKILL='amzn1.ask.skill.test-regal';
data.CFG.alexa={on:true,skillId:SKILL,word:'thunder',stock:true,price:true,money:true,news:true,
  sayOrders:true,sayHolds:true,sayCheques:false};
const item=data.S.products.find(p=>p.active!==false&&(+p.stock||0)>0);
await fetch(BASE+'/api/books/regal',{method:'PUT',headers:H,body:JSON.stringify({data,rev:got.rev})});

const ask=(intent,slots,skill=SKILL)=>fetch(BASE+'/api/alexa',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({ version:'1.0',
    context:{System:{application:{applicationId:skill}}},
    request:{type:'IntentRequest',intent:{name:intent,slots:Object.fromEntries(
      Object.entries(slots||{}).map(([k,v])=>[k,{name:k,value:v}]))}} })})
  .then(async r=>({status:r.status, text:(await r.json().catch(()=>({})))?.response?.outputSpeech?.text||''}));

/* ---- only the shop's own skill ---- */
const other=await ask('StockIntent',{item:item.name},'amzn1.ask.skill.somebody-else');
ok(other.status===403,'a request from another skill is turned away',String(other.status));

/* ---- stock and price ---- */
const st=await ask('StockIntent',{item:item.name});
ok(st.status===200&&st.text.includes(item.name),'it says how many there are',st.text);
const pr=await ask('PriceIntent',{item:item.name});
ok(pr.status===200&&/Rs/.test(pr.text),'and what it costs',pr.text);
ok(+item.mrp>+item.retail? /marked at/.test(pr.text) : true,'with the marked price where there is one');
const no=await ask('StockIntent',{item:'a thing we have never sold'});
ok(/could not find/.test(no.text),'and says so plainly when it cannot find one',no.text);

/* ---- money needs the word, in the same breath ---- */
const bare=await ask('MoneyIntent',{what:'takings'});
ok(/Not without the word/.test(bare.text),'money without the word is refused',bare.text);
const wrong=await ask('MoneyIntent',{what:'takings',word:'lightning'});
ok(/Not without the word/.test(wrong.text),'and the wrong word is refused too',wrong.text);
const right=await ask('MoneyIntent',{what:'takings',word:'THUNDER'});
ok(/bill/.test(right.text)&&/Rs/.test(right.text),'with the word, it answers',right.text);
const owed=await ask('MoneyIntent',{what:'what do customers owe',word:'thunder'});
ok(/owe/.test(owed.text)&&/Rs/.test(owed.text),'and knows what is owed from what is in the drawer',owed.text);
const drawer=await ask('MoneyIntent',{what:'in the drawer',word:'thunder'});
ok(/drawer/.test(drawer.text),'and the drawer',drawer.text);

/* ---- what is waiting ---- */
await fetch(BASE+'/api/alexa/note',{method:'POST',headers:H,body:JSON.stringify({kind:'hold',text:'Nimal, 3 lines'})});
const news=await ask('NewsIntent',{});
ok(news.status===200&&news.text.length>3,'it reads out what is waiting',news.text);
ok(/hold/.test(news.text),'including a bill the books never see, because the till reported it',news.text);

/* ---- what the shop has switched off ---- */
const g2=await (await fetch(BASE+'/api/books/regal',{headers:H})).json();
g2.data.CFG.alexa={...g2.data.CFG.alexa,money:false};
await fetch(BASE+'/api/books/regal',{method:'PUT',headers:H,body:JSON.stringify({data:g2.data,rev:g2.rev})});
const off=await ask('MoneyIntent',{what:'takings',word:'thunder'});
ok(/not switched money/.test(off.text),'money switched off is refused even with the word',off.text);

const g3=await (await fetch(BASE+'/api/books/regal',{headers:H})).json();
g3.data.CFG.alexa={...g3.data.CFG.alexa,on:false};
await fetch(BASE+'/api/books/regal',{method:'PUT',headers:H,body:JSON.stringify({data:g3.data,rev:g3.rev})});
const allOff=await ask('StockIntent',{item:item.name});
ok(/has not switched this on/.test(allOff.text),'and with the whole thing off, it says nothing useful at all',allOff.text);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

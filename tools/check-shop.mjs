// The commerce behind the shop site: delivery, stock, codes. Every one of these is checked on the
// server, because a rule that only lives in the page the customer is holding is not a rule.
import fs from 'node:fs';
const BASE='http://localhost:4000';
let pass=0,fail=0; const ok=(c,w,x='')=>{c?(pass++,console.log('PASS '+w+(x?'  '+x:''))):(fail++,console.log('FAIL '+w+(x?'  '+x:'')))};

const tok=(await (await fetch(BASE+'/api/books/login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({user:'Afridh',password:'Afridh123'})})).json()).token;
const H={'Content-Type':'application/json','Authorization':'Bearer '+tok};
const got=await (await fetch(BASE+'/api/books/regal',{headers:H})).json();
const data=got.data;

// set up the shop: a zone, a code, stock rules
const w=data.S.web.settings;
w.zones=[{id:'z1',name:'Kaduruwela town',charge:400,freeOver:20000,days:'same day'},
         {id:'z2',name:'Out of town',charge:1200,freeOver:0,days:'next day'}];
w.promos=[{code:'BUILDER10',kind:'pct',value:10,minOrder:5000,limit:0,from:'',until:'',off:false},
          {code:'GONE',kind:'amt',value:500,minOrder:0,limit:1,from:'',until:'',off:false},
          {code:'STOPPED',kind:'amt',value:500,minOrder:0,limit:0,from:'',until:'',off:true}];
w.holdStock=true; w.minOrder=1000; w.delivery=600; w.freeOver=25000;
data.CFG.stock={...(data.CFG.stock||{}),track:true};   // the website counts stock in this check
// any item the website would show; the stock it needs is put there on the next line, so there is
// no reason to insist the books already came with some
const p=data.S.products.find(x=>x.active!==false&&x.web!==false&&+x.retail>0);
if(!p){ console.log('FAIL no item the website could sell'); process.exit(1) }
p.stock=8;
await fetch(BASE+'/api/books/regal',{method:'PUT',headers:H,body:JSON.stringify({data,rev:got.rev})});

const quote=(b)=>fetch(BASE+'/api/shop/quote',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify(b)}).then(r=>r.json());
const line=(n)=>[{pid:p.id,qty:n}];
const price=p.webPrice>0?p.webPrice:(w.level==='wholesale'?p.wholesale:p.retail);

// ---- delivery by area ----
const inTown=await quote({lines:line(2),deliver:true,zone:'z1'});
const outTown=await quote({lines:line(2),deliver:true,zone:'z2'});
const collect=await quote({lines:line(2),deliver:false,zone:'z1'});
ok(inTown.del===400&&outTown.del===1200,'each area is charged its own rate',JSON.stringify({town:inTown.del,out:outTown.del}));
ok(collect.del===0,'and collecting costs nothing');

const big=await quote({lines:line(Math.ceil(20000/price)+1),deliver:true,zone:'z1'});
ok(big.del===0,'a big enough order is delivered free in that area',`goods ${big.goods}`);
const bigOut=await quote({lines:line(Math.ceil(20000/price)+1),deliver:true,zone:'z2'});
ok(bigOut.del===1200,'but not in the area that has no free line',`goods ${bigOut.goods}`);

// ---- the smallest order ----
const tiny=await quote({lines:[{pid:p.id,qty:0.001}],deliver:false});
ok(tiny.under===true,'an order under the smallest is flagged',`${tiny.goods} against ${tiny.minOrder}`);

// ---- codes ----
const good=await quote({lines:line(Math.ceil(6000/price)),deliver:false,code:'builder10'});
ok(good.off>0&&Math.abs(good.off-good.goods*0.1)<0.02,'a code takes its share off, however it is typed',
   `${good.goods} → ${good.off} off`);
const small=await quote({lines:line(1),deliver:false,code:'BUILDER10'});
ok(small.off===0&&/needs an order/.test(small.why||''),'and not on an order too small for it',small.why);
const nope=await quote({lines:line(2),deliver:false,code:'NOTACODE'});
ok(nope.off===0&&/no such code/i.test(nope.why||''),'a made-up code is worth nothing',nope.why);
const off=await quote({lines:line(2),deliver:false,code:'STOPPED'});
ok(off.off===0&&/switched off/.test(off.why||''),'and so is one that has been switched off',off.why);

// ---- stock ----
const phone='0777849964';
const otp=await (await fetch(BASE+'/api/shop/otp',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({phone})})).json();
const login=await (await fetch(BASE+'/api/shop/login',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({phone,code:otp.code,name:'Test Buyer'})})).json();
const SH={'Content-Type':'application/json','Authorization':'Bearer '+login.token};
const order=(b)=>fetch(BASE+'/api/shop/order',{method:'POST',headers:SH,body:JSON.stringify(b)}).then(async r=>({status:r.status,body:await r.json()}));

const over=await order({lines:[{pid:p.id,qty:99}],deliver:false,pay:'cod'});
ok(over.status===409&&/only|short/i.test(over.body.error||''),'an order for more than the shop has is refused',
   over.body.error);

const fine=await order({lines:line(3),deliver:true,zone:'z1',pay:'cod',address:'1 Test Lane',code:'BUILDER10'});
ok(fine.status===200&&fine.body.no,'an order it can fill goes through',fine.body.no);
ok(fine.body.del===400,'carrying the area’s charge',String(fine.body.del));

// what is now promised is gone from the catalogue
const cat=await (await fetch(BASE+'/api/shop/catalog')).json();
const seen=cat.products.find(x=>x.id===p.id);
ok(seen&&seen.stock===5,'what is on that order is taken off what the site offers',`8 → ${seen&&seen.stock}`);

const rest=await order({lines:line(6),deliver:false,pay:'cod'});
ok(rest.status===409,'and the next customer cannot buy what is already spoken for',rest.body.error);

// a code with one use left
await order({lines:line(1),deliver:false,pay:'cod',code:'GONE'});
const spent=await quote({lines:line(1),deliver:false,code:'GONE'});
ok(spent.off===0&&/used up/.test(spent.why||''),'a code runs out when it has been used its number of times',spent.why);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail?1:0);

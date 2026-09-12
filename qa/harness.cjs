// Isolated QA only: actual API routers + in-memory fixtures. Never loads .env or connects to a database.
const { createRequire } = require('node:module');
const path = require('node:path');
const requireApi = createRequire(path.resolve(__dirname, '../selvora-api/package.json'));
const express = requireApi('express');
const { randomUUID } = require('node:crypto');
const ids = { user:'11111111-1111-4111-8111-111111111111', other:'22222222-2222-4222-8222-222222222222', inventory:'33333333-3333-4333-8333-333333333333', sale:'44444444-4444-4444-8444-444444444444', vendor:'55555555-5555-4555-8555-555555555555', card:'66666666-6666-4666-8666-666666666666', platform:'77777777-7777-4777-8777-777777777777', foreign:'88888888-8888-4888-8888-888888888888' };
let db, calls, faults;
function reset() {
  calls=[]; faults={};
  db={user:[{id:ids.user,username:'QA Fixture',tutorial_seen:true,calendar_token:'qa-only-token',accounting_preferences:null}],
    platform:[{id:ids.vendor,user_id:ids.user,name:'QA Store',type:'Vendor',fee_pct:0},{id:ids.platform,user_id:ids.user,name:'QA Marketplace',type:'Marketplace',fee_pct:12,address:'QA address',notes:'Preserve notes',tax_exempt_place:false},{id:ids.foreign,user_id:ids.other,name:'Other user private platform',type:'Marketplace',notes:'PRIVATE'}],
    paymentMethod:[{id:ids.card,user_id:ids.user,name:'QA Credit Card',type:'Credit',default_cashback_rate:2,category_rates:'[]',statement_close_day:15,due_day:10,credit_limit:5000,min_payment_pct:2}],
    inventory:[{id:ids.inventory,user_id:ids.user,product_name:'QA Multi-unit Sneaker',vendor_id:ids.vendor,payment_method_id:ids.card,unit_purchase_cost:100,qty_purchased:5,qty_on_hand:3,sales_tax:40,shipping_cost_inbound:20,fees:10,gift_card_amount:50,cashback_earned:10.4,status:'PURCHASED',category:'Shoes',purchase_date:new Date('2026-09-01T12:00:00Z'),created_at:new Date(),tracking_number:'9400111899223856928499',receipt_url:null,tax_exempt:false}],
    sales:[{id:ids.sale,inventory_id:ids.inventory,platform_id:ids.platform,buyer_id:null,quantity:2,unit_price:150,commission_fee:15,sale_shipping:12,sale_tax_collected:8,taxable:true,customer_tax_exempt:false,status:'SOLD',sale_date:new Date('2026-09-03T12:00:00Z'),payout_date:null}],
    expense:[{id:randomUUID(),user_id:ids.user,name:'QA Storage',amount:25,date:new Date('2026-09-01T12:00:00Z'),category:'Storage'}],recurringExpense:[],account:[],goal:[],calendarEvent:[],productNote:[],buyer:[],invoice:[]};
}
reset();
function relations(model,row,key) {
  if(model==='inventory'&&key==='vendor') return ['platform',db.platform.find(x=>x.id===row.vendor_id)||null];
  if(model==='inventory'&&key==='payment_method') return ['paymentMethod',db.paymentMethod.find(x=>x.id===row.payment_method_id)||null];
  if(model==='inventory'&&key==='sales') return ['sales',db.sales.filter(x=>x.inventory_id===row.id)];
  if(model==='sales'&&key==='inventory') return ['inventory',db.inventory.find(x=>x.id===row.inventory_id)||null];
  if((model==='sales'||model==='account')&&key==='platform') return ['platform',db.platform.find(x=>x.id===row.platform_id)||null];
  if(key==='buyer') return ['buyer',db.buyer.find(x=>x.id===row.buyer_id)||null];
  if(model==='platform'&&key==='accounts') return ['account',db.account.filter(x=>x.platform_id===row.id)];
  return null;
}
function matches(model,row,where={}) {
  return Object.entries(where).every(([k,v])=>{
    if(k==='OR')return v.some(w=>matches(model,row,w));
    if(k==='AND')return v.every(w=>matches(model,row,w));
    const rel=relations(model,row,k); if(rel)return rel[1]&&matches(rel[0],rel[1],v);
    if(v&&typeof v==='object'&&!(v instanceof Date))return Object.entries(v).every(([op,x])=>op==='gte'?row[k]>=x:op==='lte'?row[k]<=x:op==='lt'?row[k]<x:op==='gt'?row[k]>x:op==='equals'?(v.mode==='insensitive'?String(row[k]).toLowerCase()===String(x).toLowerCase():row[k]===x):op==='in'?x.includes(row[k]):true);
    return row[k]===v;
  });
}
function project(model,row,args={}) {
  if(!row)return null;
  const result=args.select?{}:{...row};
  for(const [k,v] of Object.entries(args.select||args.include||{})) {
    if(!v)continue;
    const rel=relations(model,row,k);
    result[k]=rel?(Array.isArray(rel[1])?rel[1].map(x=>project(rel[0],x,v===true?{}:v)):project(rel[0],rel[1],v===true?{}:v)):row[k];
  }
  return structuredClone(result);
}
const prisma={};
for(const model of Object.keys(db)) {
  prisma[model]={};
  for(const op of ['findMany','findUnique','findFirst','create','createMany','update','updateMany','delete','deleteMany','upsert'])prisma[model][op]=async(args={})=>{
    calls.push({model,op,args:structuredClone(args)});
    if(faults[model+'.'+op])throw new Error('Injected '+model+'.'+op+' failure');
    const rows=db[model].filter(x=>matches(model,x,args.where));
    if(op==='findMany')return rows.map(x=>project(model,x,args));
    if(op==='findUnique'||op==='findFirst')return project(model,rows[0],args);
    if(op==='create'||op==='createMany'||(op==='upsert'&&!rows.length)) {
      const data=op==='upsert'?args.create:args.data;
      const created=(Array.isArray(data)?data:[data]).map(x=>({id:randomUUID(),...(model==='inventory'?{status:'PURCHASED',created_at:new Date()}:{}),...x}));
      db[model].push(...created);return op==='createMany'?{count:created.length}:project(model,created[0],args);
    }
    if(op==='update'||op==='updateMany'||op==='upsert'){
      for(const row of (op==='updateMany'?rows:rows.slice(0,1)))for(const[k,v]of Object.entries(op==='upsert'?args.update:args.data))if(v!==undefined){
        if(v&&typeof v==='object'&&'increment' in v)row[k]+=v.increment;
        else if(v&&typeof v==='object'&&'decrement' in v)row[k]-=v.decrement;
        else row[k]=v;
      }
      return op==='updateMany'?{count:rows.length}:project(model,rows[0],args);
    }
    db[model]=db[model].filter(x=>!rows.includes(x));
    if(model==='inventory')db.sales=db.sales.filter(x=>!rows.some(r=>r.id===x.inventory_id));
    return op==='deleteMany'?{count:rows.length}:rows[0];
  };
}
let transactionTail = Promise.resolve();
prisma.$transaction=async fn=>{
  if(typeof fn!=='function')return Promise.all(fn);
  const previous = transactionTail;
  let release;
  transactionTail = new Promise(resolve => { release = resolve; });
  await previous;
  const snapshot=structuredClone(db);
  try{return await fn(prisma);}catch(error){db=snapshot;throw error;}finally{release();}
};
require.cache[requireApi.resolve('./prisma.js')]={id:requireApi.resolve('./prisma.js'),filename:requireApi.resolve('./prisma.js'),loaded:true,exports:prisma};
requireApi('cloudinary').v2.uploader.upload=async(data,options)=>{calls.push({model:'cloudinary',op:'upload',options});return {secure_url:'https://example.invalid/qa-receipt.png'};};
function app() {
  const app=express();app.use(requireApi('./middleware/jsonBody'));
  app.use((req,res,next)=>{req.user=db.user[0];req.isAuthenticated=()=>req.headers['x-qa-unauthenticated']!=='true';next();});
  app.get('/auth/me',(req,res)=>res.json(db.user[0]));
  app.use(requireApi('./middleware/currencyJSON'));
  for(const [url,file]of Object.entries({'inventory':'inventory','sales':'sales','platforms':'platforms','payment-methods':'paymentMethods','accounts':'accounts','analytics':'analytics','creditcard':'creditcard','expenses':'expenses','recurring-expenses':'recurringExpenses','receipts':'receipts','goals':'goals','calendar-events':'calendarEvents','product-notes':'productNotes','preferences':'preferences'}))app.use('/api/'+url,requireApi('./routes/'+file+'.js'));
  app.use((err,req,res,next)=>res.status(err.status||500).json({error:err.message}));
  return app;
}
module.exports={app,reset,ids,prisma,get db(){return db;},get calls(){return calls;},get faults(){return faults;}};
if(require.main===module)(async()=>{
  const {pathToFileURL}=require('node:url');
  const {createServer}=await import(pathToFileURL(path.resolve(__dirname,'../selvora-app/node_modules/vite/dist/node/index.js')));
  // Empty API base and Sentry DSNs prevent accidental calls to production services.
  process.env.VITE_API_URL='';process.env.VITE_SENTRY_DSN='';
  const server=app();
  const vite=await createServer({root:path.resolve(__dirname,'../selvora-app'),server:{middlewareMode:true},appType:'spa'});
  server.use(vite.middlewares);
  server.listen(4175,'127.0.0.1',()=>console.log('QA fixture website http://127.0.0.1:4175 (in-memory only)'));
})();

const crypto=require('node:crypto');
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const {PrismaClient}=require('@prisma/client');
const db=new URL(process.env.DATABASE_URL||'');
if(!['localhost','127.0.0.1'].includes(db.hostname)||!/(preview|test|ci)/i.test(db.pathname)||process.env.VERCEL_ENV==='production'||process.env.APP_ENV==='production'||process.env.ALLOW_SYNTHETIC_SEED!=='true'||process.env.PREVIEW_DATASET_ID!=='focus-media-synthetic-v1')throw Error('Isolated local synthetic DB required');
const base=(process.env.NEXT_PUBLIC_BASE_URL||'http://127.0.0.1:3111').replace(/\/$/,'');
if(!['localhost','127.0.0.1'].includes(new URL(base).hostname))throw Error('Local app required');
const prisma=new PrismaClient({log:[]});const id='crm-ui-outcome-'+crypto.randomUUID();const name='Synthetic UI Lost Response '+crypto.randomUUID();
const password='Synthetic-Browser-Only-CRM-2026!';
function hash(s){const salt=crypto.randomBytes(16);return `scrypt$${salt.toString('base64url')}$${crypto.scryptSync(s,salt,64).toString('base64url')}`}
(async()=>{let browser;try{
 await prisma.user.create({data:{id,email:id+'@example.invalid',name:'Synthetic CRM Browser',role:'SALES_AGENT',passwordHash:hash(password)}});
 browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}:{}),headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({bypassCSP:process.env.CRM_SMOKE_BYPASS_CSP==='true',viewport:{width:390,height:844}});
 await context.route('**/*',route=>{const u=new URL(route.request().url());return u.origin===new URL(base).origin?route.continue():route.abort()});
 const login=await context.request.post(base+'/api/auth/login',{headers:{origin:base},data:{email:id+'@example.invalid',password}});assert.equal(login.status(),200);
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.name));
 let posts=0,key;
 await context.route('**/api/admin/crm/commands',async route=>{
  if(route.request().method()!=='POST')return route.continue();posts++;key=route.request().postDataJSON().idempotencyKey;
  const r=await route.fetch();assert.equal(r.status(),200);assert.equal((await r.json()).outcome,'committed');return route.abort('failed');
 });
 await page.goto(base+'/admin/crm',{timeout:120000});
 await page.getByRole('button',{name:'Prospect nou',exact:true}).click({timeout:90000});
 await page.getByLabel('Firmă *',{exact:true}).fill(name);
 await page.getByRole('button',{name:'Creează',exact:true}).click();
 await page.getByText('Rezultatul ultimei salvări trebuie verificat',{exact:true}).waitFor({timeout:90000});
 assert.equal(await page.getByRole('button',{name:'Creează',exact:true}).isDisabled(),true);
 const prior=await page.evaluate(()=>Object.entries(sessionStorage).filter(([k])=>k.startsWith('focus.crm.unresolved.')));assert.equal(prior.length,1);assert.equal(JSON.parse(prior[0][1]).key,key);assert.equal(prior[0][1].includes(name),false);
 await page.reload({timeout:90000});await page.getByRole('button',{name:'Prospect nou',exact:true}).click({timeout:90000});
 await page.getByText('Rezultatul ultimei salvări trebuie verificat',{exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Creează',exact:true}).isDisabled(),true);
 await page.getByRole('button',{name:'Verifică rezultatul fără retrimitere',exact:true}).click();
 await page.getByText('Rezultatul intenției a fost verificat în istoric. Comanda nu a fost repetată.',{exact:true}).waitFor({timeout:90000});
 assert.equal(posts,1);assert.equal(await prisma.crmProspect.count({where:{company:{name}}}),1);
 const after=await page.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith('focus.crm.unresolved.')));assert.equal(after.length,0);assert.deepEqual(errors,[]);
 console.log(JSON.stringify({ok:true,width:390,responseLossAfterCommit:true,posts,stableKeyAcrossReload:true,readOnlyRecovery:true,pageErrors:errors.length}));
 }finally{if(browser)await browser.close();const companies=await prisma.crmCompany.findMany({where:{name},select:{id:true}});const companyIds=companies.map(x=>x.id);await prisma.crmEvent.deleteMany({where:{companyId:{in:companyIds}}});await prisma.crmNextAction.deleteMany({where:{companyId:{in:companyIds}}});await prisma.crmOpportunity.deleteMany({where:{companyId:{in:companyIds}}});await prisma.crmProspect.deleteMany({where:{companyId:{in:companyIds}}});await prisma.crmCompanyContact.deleteMany({where:{companyId:{in:companyIds}}});await prisma.crmCompany.deleteMany({where:{id:{in:companyIds}}});await prisma.auditLog.deleteMany({where:{userId:id}});await prisma.user.deleteMany({where:{id}});await prisma.$disconnect();}})().catch(e=>{console.error(e.message);process.exitCode=1});

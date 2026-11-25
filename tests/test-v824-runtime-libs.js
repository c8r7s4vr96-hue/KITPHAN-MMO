'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const cfg=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
assert.equal(cfg.functions?.['api/*.js']?.includeFiles,'lib/**','All Vercel API functions must include lib files');
const api=fs.readdirSync(path.join(root,'api')).filter(n=>n.endsWith('.js'));
assert.equal(api.length,12,'Preserve 12-function Hobby cap');
let checked=0;
for(const folder of ['api','lib'])for(const filename of fs.readdirSync(path.join(root,folder)).filter(n=>n.endsWith('.js'))){
  const file=path.join(root,folder,filename),src=fs.readFileSync(file,'utf8');
  const re=/require\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g;
  for(const m of src.matchAll(re)){
    const target=path.resolve(path.dirname(file),m[1]);
    assert(fs.existsSync(target)||fs.existsSync(target+'.js')||fs.existsSync(path.join(target,'index.js')),`Missing ${m[1]} from ${folder}/${filename}`);
    checked++;
  }
}
console.log('PASS all '+checked+' local imports found, 12 routes, lib included by Vercel');

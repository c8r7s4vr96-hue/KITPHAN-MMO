'use strict';
const assert=require('node:assert/strict');
const {classifyResponse,fulfillmentText}=require('../lib/shop-fulfillment');
const cases=[
 [{success:true,data:{delivery:{email:'buyer@example.test',password:'demo-pwd'}}},'delivered'],
 [{success:true,delivery:{items:['code1','code2']}},'delivered'],
 [{success:true,data:{delivered_accounts:[{username:'account1',password:'password1'}]}},'delivered'],
 [{success:true,status:'processing',data:{delivery:'account:pass'}},'pending'],
 [{success:true,data:{order_id:12,balance:999999}},'pending'],
 [{success:true,message:'Mua hàng thành công'},'pending'],
 [{success:false,message:'out of stock'},'rejected'],
 [{status:'failed',data:{delivery:'secret'}},'rejected'],
 [{status:'completed'},'pending'],
];
for(const [payload,expected] of cases){const out=classifyResponse(payload);assert.equal(out.kind,expected,JSON.stringify(payload));}
assert(!fulfillmentText({data:{order_id:2,wallet_balance:100000}}));
assert.equal(classifyResponse({delivery:{account:{email:'x@y.z',pass:'123456'}}}).kind,'delivered');
console.log('PASS fulfillment scenarios',cases.length+2);

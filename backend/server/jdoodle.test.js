import test from 'node:test';
import assert from 'node:assert/strict';
import { executeJdoodle } from './jdoodle.js';

test('JDoodle forwards credentials and JavaScript submission to the server API', async () => {
  const keys=['JDOODLE_CLIENT_ID','JDOODLE_CLIENT_SECRET','JDOODLE_API_URL','JDOODLE_JAVASCRIPT_VERSION_INDEX'];
  const previous=Object.fromEntries(keys.map(key=>[key,process.env[key]])),fetch=globalThis.fetch;
  Object.assign(process.env,{JDOODLE_CLIENT_ID:'client-test',JDOODLE_CLIENT_SECRET:'secret-test',JDOODLE_API_URL:'https://jdoodle.test/v1/execute',JDOODLE_JAVASCRIPT_VERSION_INDEX:'3'});
  let request;
  globalThis.fetch=async(url,options)=>{request={url:String(url),body:JSON.parse(options.body)};return new Response(JSON.stringify({output:'answer\n',statusCode:200,cpuTime:'0.01',memory:'2048'}),{status:200,headers:{'content-type':'application/json'}})};
  try {
    assert.deepEqual(await executeJdoodle('JavaScript','console.log("answer")',''),{output:'answer\n',cpuTime:'0.01',memory:'2048'});
    assert.equal(request.url,'https://jdoodle.test/v1/execute');
    assert.equal(request.body.clientSecret,'secret-test');
    assert.equal(request.body.language,'nodejs');
    assert.equal(request.body.versionIndex,'3');
  } finally { globalThis.fetch=fetch;for(const key of keys)if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key]; }
});

test('JDoodle errors when credentials are missing instead of returning sample output', async () => {
  const clientId=process.env.JDOODLE_CLIENT_ID,clientSecret=process.env.JDOODLE_CLIENT_SECRET;
  delete process.env.JDOODLE_CLIENT_ID;delete process.env.JDOODLE_CLIENT_SECRET;
  try { await assert.rejects(executeJdoodle('Python','print(1)'),{status:503}); }
  finally { if(clientId!==undefined)process.env.JDOODLE_CLIENT_ID=clientId;if(clientSecret!==undefined)process.env.JDOODLE_CLIENT_SECRET=clientSecret; }
});

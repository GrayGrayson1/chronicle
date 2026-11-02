import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
import OpusScript from 'opusscript';
import { Recorder } from '../src/audio.js';

function fixture() {
  const submitted=[];
  const stream=new PassThrough();
  const speaking=new EventEmitter(); speaking.users=new Map();
  let subscriptions=0;
  const recorder=new Recorder({
    channel:{members:new Map([['user',{user:{bot:false},displayName:'Jon'}]])},
    session:{id:'12345678',started:Date.now()}, campaign:{id:'campaign'},
    store:{label:()=> 'Jon / Zafir'}, audio:{submit:(...args)=>submitted.push(args)},
    onFailure:error=>assert.fail(error.message),onTimeout:()=>{},maxHours:1,
  });
  recorder.connection={receiver:{speaking,subscribe:()=>{subscriptions++; return stream;}}};
  return {recorder,stream,submitted,get subscriptions(){return subscriptions;}};
}

test('voice recorder never subscribes to a speaker without explicit consent',()=>{
  const f=fixture(); f.recorder.capture('user');
  assert.equal(f.subscriptions,0); assert.equal(f.submitted.length,0);
});

test('opted-in Opus audio is decoded and saved with the individual character label',async()=>{
  const f=fixture(), encoder=new OpusScript(48000,2,OpusScript.Application.AUDIO);
  f.recorder.consent('user'); f.recorder.capture('user');
  const packet=encoder.encode(Buffer.alloc(960*2*2),960);
  for (let i=0;i<20;i++) f.stream.write(packet);
  f.stream.end(); await new Promise(resolve=>setImmediate(resolve)); encoder.delete();
  assert.equal(f.submitted.length,1); assert.equal(f.submitted[0][1],'Jon / Zafir');
  assert.ok(f.submitted[0][3].length>0);
});

test('revoking consent drops unsaved audio and prevents future capture',async()=>{
  const f=fixture(), encoder=new OpusScript(48000,2,OpusScript.Application.AUDIO);
  f.recorder.consent('user'); f.recorder.capture('user');
  f.stream.write(encoder.encode(Buffer.alloc(960*2*2),960));
  f.recorder.revoke('user'); f.recorder.capture('user');
  await new Promise(resolve=>setImmediate(resolve)); encoder.delete();
  assert.equal(f.subscriptions,1); assert.equal(f.submitted.length,0);
  assert.equal(f.recorder.streams.size,0);
});

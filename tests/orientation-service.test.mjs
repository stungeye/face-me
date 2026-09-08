import { test } from "node:test";
import assert from "node:assert/strict";
import { createOrientationService, normalizeOrientationEvent, normalizeGenericOrientation, transformEarthToPhone } from "../orientation-service.js";
import { deviceOrientationMatrix, earthToLocalFromRowMajorMatrix, earthToLocalFromSensorMatrix } from "../core.js";
const near = (a,b) => a.forEach((v,i) => assert.ok(Math.abs(v-b[i]) < 1e-6, `${a} != ${b}`));
const identity = [1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1];
test("Pixel portrait transforms remain unchanged and screen rotation preserves physical edge", () => {
  const matrix = [0,-1,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1];
  near(transformEarthToPhone(normalizeGenericOrientation(matrix,0,1).transform,[0,1,0]), earthToLocalFromSensorMatrix(matrix,[0,1,0]));
  near(transformEarthToPhone(normalizeGenericOrientation(matrix,90,1).transform,[0,1,0]),[0,1,0]);
  assert.equal(normalizeGenericOrientation(identity,NaN,0),null);
  assert.equal(normalizeGenericOrientation([1,0,0,0, 1,0,0,0, 0,0,1,0, 0,0,0,1],0,0),null);
});
test("Apple cardinal headings retain tilt and roll including inverted poses", () => {
  for (const heading of [0,90,180,270]) for (const beta of [-60,0,45,120]) for (const gamma of [-40,0,35]) {
    const reading = normalizeOrientationEvent({alpha:17,beta,gamma,webkitCompassHeading:heading,webkitCompassAccuracy:5},"deviceorientation",1);
    const expected = deviceOrientationMatrix((Math.cos(beta*Math.PI/180)<0?180:0)-heading,beta,gamma);
    for (const vector of [[1,0,0],[0,1,0],[0,0,1]]) near(transformEarthToPhone(reading.transform,vector),earthToLocalFromRowMajorMatrix(expected,vector));
    assert.equal(reading.northReference,"magnetic");
  }
});
test("null, relative, inaccurate, and singular readings are rejected", () => {
  for (const event of [{alpha:null,beta:0,gamma:0,absolute:true},{alpha:0,beta:0,gamma:0}, {beta:0,gamma:0,webkitCompassHeading:0,webkitCompassAccuracy:-1},{beta:0,gamma:0,webkitCompassHeading:0,webkitCompassAccuracy:80},{beta:90,gamma:0,webkitCompassHeading:0,webkitCompassAccuracy:5}]) assert.equal(normalizeOrientationEvent(event,"deviceorientation",1),null);
});
function harness(generic=false) {
  let time=100, id=0;
  const timers=new Map(), handlers=new Map(), sensors=[], readings=[], statuses=[];
  const environment={addEventListener:(n,h)=>handlers.set(n,h),removeEventListener:(n,h)=>{if(handlers.get(n)===h)handlers.delete(n);},screen:{orientation:{angle:0}}};
  if(generic) environment.AbsoluteOrientationSensor=class {
    constructor(){this.handlers={};sensors.push(this);} addEventListener(n,h){this.handlers[n]=h;} start(){} stop(){this.stopped=true;} populateMatrix(out){out.set(identity);}
  };
  const service=createOrientationService({environment,now:()=>time,onReading:r=>readings.push(r),onStatus:s=>statuses.push(s),setTimer:(f,delay)=>{timers.set(++id,{f,at:time+delay});return id;},clearTimer:i=>timers.delete(i)});
  return {service,environment,sensors,readings,statuses,handlers,timers,emit:(n,e)=>handlers.get(n)?.(e),tick(t){time=t;for(const [i,item] of [...timers])if(item.at<=t){timers.delete(i);item.f();}}};
}
test("delayed generic sensor hands off once; stale absolute events recover from fallback",()=>{
  const h=harness(true);h.service.start();assert.equal(h.handlers.size,0);h.tick(800);assert.equal(h.sensors[0].stopped,true);assert.equal(h.handlers.size,2);
  h.sensors[0].handlers.reading();assert.equal(h.readings.length,0);
  h.emit("deviceorientationabsolute",{alpha:0,beta:0,gamma:0});
  h.emit("deviceorientation",{alpha:90,beta:0,gamma:0,absolute:true});assert.equal(h.readings.length,1);
  h.tick(2800);h.emit("deviceorientation",{alpha:90,beta:0,gamma:0,absolute:true});assert.equal(h.readings.length,2);
  h.service.stop();assert.equal(h.handlers.size,0);assert.equal(h.timers.size,0);
});
test("generic errors and stale readings release sensor ownership",()=>{
  const h=harness(true);h.service.start();h.sensors[0].handlers.reading();assert.equal(h.service.snapshot.state,"ready");h.tick(2100);assert.equal(h.sensors[0].stopped,true);assert.equal(h.handlers.size,2);
  h.service.start();h.sensors[1].handlers.error({error:new Error("blocked")});assert.equal(h.sensors[1].stopped,true);h.service.stop();
});
test("Apple calibrated yaw reaches antipode vertically for a bounded interval",()=>{
  const h=harness();h.service.start();const event={alpha:0,beta:0,gamma:0,webkitCompassHeading:0,webkitCompassAccuracy:5};
  h.emit("deviceorientation",event);h.tick(200);h.emit("deviceorientation",{...event,beta:-90});
  near(transformEarthToPhone(h.readings.at(-1).transform,[0,0,-1]),[0,1,0]);assert.equal(h.readings.at(-1).quality,"propagated");
  h.tick(2200);h.emit("deviceorientation",{...event,beta:-90});assert.equal(h.service.snapshot.reading,null);h.service.stop();
});
test("permission is requested synchronously and denied status cannot leak after stop",async()=>{
  const h=harness();let reject;let called=false;h.environment.DeviceOrientationEvent={requestPermission(){called=true;return new Promise((_,r)=>reject=r);}};
  const pending=h.service.requestPermission();assert.equal(called,true);h.service.stop();reject(new Error("denied"));await assert.rejects(pending);assert.equal(h.service.snapshot.state,"idle");assert.equal(h.handlers.size,0);
});

test("Apple top-edge azimuth and elevation map to physical +Y independently of roll", () => {
  for(const heading of [0,37,90,180,270]) for(const beta of [-60,0,45,120]) for(const gamma of [-40,0,35]) {
    const h=heading*Math.PI/180,b=beta*Math.PI/180;
    const top=[Math.sin(h)*Math.abs(Math.cos(b)),Math.cos(h)*Math.abs(Math.cos(b)),Math.sin(b)];
    const reading=normalizeOrientationEvent({alpha:17,beta,gamma,webkitCompassHeading:heading,webkitCompassAccuracy:5},"deviceorientation",1);
    near(transformEarthToPhone(reading.transform,top),[0,1,0]);
  }
});

test("captured Pixel matrix passes adapter and keeps east chord ahead and below", () => {
  const matrix=[0.192584,0.981080,-0.019863,0,-0.981264,0.192660,0.001964,0,0.005754,0.019113,0.999801,0,0,0,0,1];
  const reading=normalizeGenericOrientation(matrix,0,1);
  assert.ok(reading);
  const local=transformEarthToPhone(reading.transform,[0.999230,-0.000002,-0.039230]);
  assert.ok(local[1]>0.97);assert.ok(local[2]<0);
});

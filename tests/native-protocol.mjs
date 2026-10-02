import {createConnection,createServer} from 'node:net';
import {setTimeout as pause} from 'node:timers/promises';

function commands(write){
  let next=0;const pending=new Map();
  return {send(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++next,timeout=setTimeout(()=>{pending.delete(id);reject(new Error(`Browser command timed out: ${method}`));},20000);pending.set(id,{resolve,reject,timeout});write({id,method,params,...(sessionId?{sessionId}:{})});});},receive(id,error,result){const request=pending.get(id);if(!request)return;pending.delete(id);clearTimeout(request.timeout);error?request.reject(new Error(error.message??String(error))):request.resolve(result);},fail(error){for(const request of pending.values()){clearTimeout(request.timeout);request.reject(error);}pending.clear();}};
}
export function chromePipe(child){
  const protocol=commands(value=>child.stdio[3].write(JSON.stringify(value)+'\0'));let input=Buffer.alloc(0);
  child.stdio[4].on('data',chunk=>{input=Buffer.concat([input,chunk]);let end;while((end=input.indexOf(0))>=0){const value=JSON.parse(input.subarray(0,end));input=input.subarray(end+1);if(value.id)protocol.receive(value.id,value.error,value.result);}if(input.length>8*1024*1024)protocol.fail(new Error('Excessive browser response.'));});
  child.on('error',error=>protocol.fail(error));child.on('exit',()=>protocol.fail(new Error('Chrome exited.')));return protocol;
}
export async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
export async function firefoxMarionette(port){
  let socket;
  for(let attempt=0;attempt<150;attempt++){
    try{socket=await new Promise((resolve,reject)=>{const client=createConnection({host:'127.0.0.1',port});client.once('connect',()=>resolve(client));client.once('error',error=>{client.destroy();reject(error);});});break;}catch{await pause(100);}
  }
  if(!socket)throw new Error('Firefox did not start its local Marionette server.');
  const protocol=commands(({id,method,params})=>{const body=JSON.stringify([0,id,method,params]);socket.write(`${Buffer.byteLength(body)}:${body}`);});let input=Buffer.alloc(0);
  socket.on('data',chunk=>{input=Buffer.concat([input,chunk]);while(true){const colon=input.indexOf(58);if(colon<0)break;const length=Number(input.subarray(0,colon).toString());if(!Number.isSafeInteger(length)||length<1||length>8*1024*1024){protocol.fail(new Error('Invalid Firefox response frame.'));socket.destroy();break;}if(input.length<colon+1+length)break;const value=JSON.parse(input.subarray(colon+1,colon+1+length));input=input.subarray(colon+1+length);if(Array.isArray(value)&&value[0]===1)protocol.receive(value[1],value[2],value[3]);}});
  socket.on('error',error=>protocol.fail(error));socket.on('close',()=>protocol.fail(new Error('Firefox connection closed.')));return {...protocol,close:()=>socket.destroy()};
}

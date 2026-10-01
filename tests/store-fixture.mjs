import { webcrypto } from 'node:crypto';

export function wireStore(context){
  context.crypto=webcrypto;
  let store;
  context.chrome.runtime??={};
  const previous=context.chrome.runtime.sendMessage;
  context.chrome.runtime.sendMessage=async (...args)=>{
    const message=args[0];if(message?.type!=='HCL_STORE')return previous?.(...args);
    store??=context.HumbleComicLibrary.createSyncStore(context.chrome.storage.local);
    try{return {ok:true,result:await store.execute(message.operation,message.args)};}
    catch(error){return {ok:false,error:error.message};}
  };
}

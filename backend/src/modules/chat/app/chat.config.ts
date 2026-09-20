                                              

export const REQUEST_TIMEOUT =
  Number(process.env.CHAT_REQUEST_TIMEOUT ?? 600_000);

                      
export const RATE_LIMIT =
  Number(process.env.CHAT_RATE_LIMIT ?? 5);

                  
export const MAX_CONCURRENT_STREAMS =
  Number(process.env.CHAT_MAX_CONCURRENT_STREAMS ?? 3);

                 
export const EMIT_INTERVAL =
  Number(process.env.CHAT_EMIT_INTERVAL ?? 16);

           
export const PERSIST_INTERVAL =
  Number(process.env.CHAT_PERSIST_INTERVAL ?? 150);
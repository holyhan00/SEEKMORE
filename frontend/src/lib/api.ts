                          
import { api } from './http';
export { api } from './http';

                                                     
         
                                                     
export const pingBackend = async (): Promise<{ pong: boolean }> => {
  const { data } = await api.get('/ping');
  return data;
};

              
export const listAgents = async () => {
  const { data } = await api.get('/agent/list');
  return data;
};
export const listMyAccessibleAgents = async () => {
  const { data } = await api.get('/agent/my');
  return data;
};

export * from './chat-api';

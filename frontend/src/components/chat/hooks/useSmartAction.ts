                                  
import { useEffect } from 'react';

type SmartAction =
  | { type: 'acg.start'; payload?: any }
  | { type: 'chat.prefillSend'; payload: { text: string } }
  | { type: 'vote.create'; payload?: any }
  | { type: 'search.run'; payload?: any }
  | { type: string; payload?: any };

export function useSmartAction() {
  useEffect(() => {
    const onTrigger = (e: Event) => {
      const action = (e as CustomEvent<SmartAction>).detail;
      if (!action?.type) return;

      switch (action.type) {
        case 'chat.prefillSend': {
          const text = action.payload?.text || '';
          if (text) {
            window.dispatchEvent(new CustomEvent('chat:prefill', { detail: { text } }));
            window.dispatchEvent(new CustomEvent('chat:send'));
          }
          break;
        }

        case 'acg.start': {
                                              
                                                       
          window.dispatchEvent(new CustomEvent('acg:start', { detail: action.payload || {} }));
          break;
        }

        case 'vote.create': {
          window.dispatchEvent(new CustomEvent('vote:create', { detail: action.payload || {} }));
          break;
        }

        case 'search.run': {
          window.dispatchEvent(new CustomEvent('search:run', { detail: action.payload || {} }));
          break;
        }

        default: {
                              
          window.dispatchEvent(new CustomEvent(action.type, { detail: action.payload || {} }));
        }
      }
    };

    window.addEventListener('smartAction:trigger', onTrigger as EventListener);
    return () => {
      window.removeEventListener('smartAction:trigger', onTrigger as EventListener);
    };
  }, []);
}

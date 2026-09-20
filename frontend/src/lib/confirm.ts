                              
export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
};

type InternalShowEvent = {
  type: 'SHOW_CONFIRM';
  payload: ConfirmOptions & { resolve: (ok: boolean) => void };
};

type Listener = (e: InternalShowEvent) => void;

class ConfirmBus {
  private listeners = new Set<Listener>();

  subscribe(l: Listener) {
                                            
    this.listeners.add(l);
    return () => {
                                                
      this.listeners.delete(l);
    };
  }

  show(options: ConfirmOptions) {
                                                       
    return new Promise<boolean>((resolve) => {
      const evt: InternalShowEvent = { type: 'SHOW_CONFIRM', payload: { ...options, resolve } };
                                                                                                 
      this.listeners.forEach((l) => l(evt));
    });
  }
}

export const confirmBus = new ConfirmBus();

        
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return confirmBus.show(options);
}
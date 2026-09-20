                                             
import React, { useEffect, useState, useCallback } from 'react';
import ConfirmModal from './ConfirmModal';
import { confirmBus, ConfirmOptions } from '../../lib/confirm';

type ConfirmHostProps = {

};

const ConfirmHost: React.FC<ConfirmHostProps> = ({  }) => {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [resolver, setResolver] = useState<((ok: boolean) => void) | null>(null);

  const resolveAndClose = useCallback((ok: boolean) => {
                                                       
    resolver?.(ok);
    setOpen(false);
    setResolver(null);
    setOpts(null);
  }, [resolver]);

  useEffect(() => {
                                                         
    const unsub = confirmBus.subscribe((evt) => {
      if (evt.type !== 'SHOW_CONFIRM') return;
                                                                        
      setOpts(evt.payload);
      setResolver(() => evt.payload.resolve);
      setOpen(true);
    });
    return () => {
                                                          
      unsub();
    };
  }, []);

  return (
    <ConfirmModal
      isOpen={open}
      onClose={() => resolveAndClose(false)}
      onConfirm={() => resolveAndClose(true)}

      title={opts?.title || ''}
      description={opts?.description}
      confirmText={opts?.confirmText}
      cancelText={opts?.cancelText}
      danger={!!opts?.danger}
      portalContainerId="shell-portal"
    />
  );
};

export default ConfirmHost;
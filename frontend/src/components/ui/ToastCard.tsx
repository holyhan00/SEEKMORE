                                           
import React, { useEffect, useState } from 'react';

interface ToastCardProps {
  text: string;
  duration?: number;

  onClose?: () => void; 
}

const ToastCard: React.FC<ToastCardProps> = ({ text, duration = 2000, onClose }) => {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    setVisible(true); 
    const timer = setTimeout(() => {
      setVisible(false);
      onClose?.();     
    }, duration);
    return () => clearTimeout(timer);
  }, [duration, onClose]);

  if (!visible) return null;

  const bg = 'bg-[#f7f7f7] text-gray-800 dark:bg-[#2a2a2a] dark:text-[#ffffff]';

  return (
    <div
      className={`fixed left-1/2 top-[15%] -translate-x-1/2 z-[999]
                  w-[240px] px-6 py-3 rounded-[10px] shadow-lg border border-[#3333]/20 
                  text-sm font-medium text-center break-words transition-opacity duration-300 ${bg}`}
      style={{ opacity: visible ? 1 : 0 }}
      role="status"
      aria-live="polite"
    >
      {text}
    </div>
  );
};

export default ToastCard;
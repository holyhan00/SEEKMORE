                                                     
import React from'react';

interface SettingButtonProps {
  onClick?: () => void;
  children: React.ReactNode;
  variant?: 'primary' | 'secondary' | 'danger';

  className?: string;
}

const SettingButton: React.FC<SettingButtonProps> = ({
  onClick,
  children,
  variant = 'secondary',
    className = '',
}) => {
  const getButtonClasses = () => {
    const baseClasses = 'w-[90%] text-left pl-[10px] rounded-[15px] text-[12px] transition-all duration-200 select-none';
    
              
    const variantClasses = {
      primary: 'bg-[#D3D3D3] hover:bg-[#D3D3D3] text-gray-800 dark:bg-[#2c3e50] dark:hover:bg-[#34495e] dark:text-blue-300',
      secondary: 'bg-surface-button-muted hover:bg-[#D3D3D3] text-gray-800  dark:hover:bg-[#3a3a3a] dark:text-gray-100',
      danger: 'bg-[#FA5151] hover:bg-[#ffccc7] text-[#FFFFFF] dark:bg-[#4e2a2a] dark:hover:bg-[#5e3434] dark:text-red-300',
    };
    
    return `${baseClasses} ${variantClasses[variant] || variantClasses.secondary} ${className}`;
  };

  return (
    <button
      onClick={onClick}
      className={getButtonClasses()}
      style={{ height: '44px' }}
    >
      {children}
    </button>
  );
};

export default SettingButton;  
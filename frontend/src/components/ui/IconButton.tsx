                                           
import React from 'react';

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon: React.ReactNode;
  title: string;

}

const IconButton: React.FC<IconButtonProps> = ({ 
  icon, 
  title, 
  onClick, 
  className = '', 
    ...props
}) => {
  return (
    <button
      onClick={onClick}
      title={title}
      {...props} 
      className={`
        w-[2.5rem] h-[2.5rem]  
        min-w-[2.5rem] min-h-[2.5rem]  
        flex items-center justify-center 
        rounded-lg  
        transition-colors duration-200
        ${className}
        ${props.disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        ${'bg-transparent hover:bg-[#e4e4e4] active:bg-[#d4d4d4] dark:bg-transparent dark:hover:bg-[#2a2a2a] dark:active:bg-[#3a3a3a]'
        }
        focus:outline-none
      `}
    >
      {icon}
    </button>
  );
};

export default IconButton;


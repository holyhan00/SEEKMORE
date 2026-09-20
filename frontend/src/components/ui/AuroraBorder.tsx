                                              

import {
  useId,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import './AuroraBorder.css';

type AuroraBorderStyle = CSSProperties & {
  '--aurora-border-radius': string;
  '--aurora-border-width': string;
  '--aurora-flow-duration': string;
};

export type AuroraBorderTone =
  | 'dark'
  | 'light';

export type AuroraBorderMotion =
  | 'gradient'
  | 'perimeter';

export interface AuroraBorderProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  children: ReactNode;
  radius?: number;
  borderWidth?: number;
  duration?: number;
  glow?: boolean;
  tone?: AuroraBorderTone;
  motion?: AuroraBorderMotion;
}

   
                                   
  
            
                                                        
  
             
                                                                    
  
                                                    
   
export function AuroraBorder({
  children,
  className,
  radius = 16,
  borderWidth = 1,
  duration = 6,
  glow = true,
  tone = 'dark',
  motion = 'gradient',
  style,
  ...props
}: AuroraBorderProps) {
  const generatedId = useId();

  const perimeterGradientId = `aurora-perimeter-${generatedId.replace(
    /:/g,
    '',
  )}`;

  const customStyle: AuroraBorderStyle = {
    ...style,
    '--aurora-border-radius': `${radius}px`,
    '--aurora-border-width': `${borderWidth}px`,
    '--aurora-flow-duration': `${duration}s`,
  };

  return (
    <div
      {...props}
      className={clsx(
        'aurora-border',
        `aurora-border--${tone}`,
        `aurora-border--motion-${motion}`,
        glow && 'aurora-border--glow',
        className,
      )}
      style={customStyle}
    >
      {motion === 'perimeter' ? (
        <svg
          aria-hidden="true"
          className="aurora-border__perimeter"
          width="100%"
          height="100%"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient
              id={perimeterGradientId}
              x1="0%"
              y1="0%"
              x2="100%"
              y2="100%"
            >
              <stop
                offset="0%"
                stopColor="var(--aurora-perimeter-start)"
              />

              <stop
                offset="34%"
                stopColor="var(--aurora-perimeter-middle)"
              />

              <stop
                offset="68%"
                stopColor="var(--aurora-perimeter-end)"
              />

              <stop
                offset="100%"
                stopColor="var(--aurora-perimeter-start)"
              />
            </linearGradient>
          </defs>

          <rect
            className="aurora-border__perimeter-base"
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx={radius}
            ry={radius}
            pathLength="100"
          />

          {glow && (
            <rect
              className="aurora-border__perimeter-glow"
              x="0"
              y="0"
              width="100%"
              height="100%"
              rx={radius}
              ry={radius}
              pathLength="100"
              stroke={`url(#${perimeterGradientId})`}
            />
          )}

          <rect
            className="aurora-border__perimeter-edge"
            x="0"
            y="0"
            width="100%"
            height="100%"
            rx={radius}
            ry={radius}
            pathLength="100"
            stroke={`url(#${perimeterGradientId})`}
          />
        </svg>
      ) : (
        <>
          {glow && (
            <div
              aria-hidden="true"
              className="aurora-border__glow"
            >
              <div className="aurora-border__flow" />
            </div>
          )}

          <div
            aria-hidden="true"
            className="aurora-border__edge"
          >
            <div className="aurora-border__flow" />
          </div>
        </>
      )}

      <div className="aurora-border__content">
        {children}
      </div>
    </div>
  );
}

export default AuroraBorder;
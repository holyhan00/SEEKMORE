                                      
import React from 'react';

type LiquidGlassProps = {
  width?: number | string;
  height?: number | string;
  radius?: number;
  glassOpacity?: number;                     
  showSpecular?: boolean;
  specularOpacity?: number;
  showStroke?: boolean;
  strokeOpacity?: number;
  showShadow?: boolean;
  shadowOpacity?: number;
                                           
  isDark?: boolean;

                                          
  vibrancy?: boolean;
  vibrancyOpacity?: number;         

             
  visible?: boolean;
  className?: string;
  style?: React.CSSProperties;
  children?: React.ReactNode;
  trySafariDisplacement?: boolean;
};

const LiquidGlass: React.FC<LiquidGlassProps> = ({
  width,
  height,
  radius = 16,
  glassOpacity = 0.55,
  showSpecular = true,
  specularOpacity = 0.45,
  showStroke = true,
  strokeOpacity = 0.24,
  showShadow = true,
  shadowOpacity = 0.16,
  isDark = false,
  vibrancy = true,
  vibrancyOpacity = 0.12,
  visible = true,
  className = '',
  style,
  children,
  trySafariDisplacement = false,
}) => {
  const stroke = `rgba(255,255,255,${isDark ? strokeOpacity * 0.65 : strokeOpacity})`;
  const shadow = showShadow ? `0 10px 24px rgba(0,0,0,${shadowOpacity})` : undefined;

  const displacementId = React.useMemo(
    () => `lg-disp-${Math.random().toString(36).slice(2, 9)}`,
    []
  );

  const backdropValue = `${trySafariDisplacement ? `url(#${displacementId}) ` : ''}blur(22px) saturate(1.55) contrast(1.04)`;
  const webkitBackdropValue = `${trySafariDisplacement ? `url(#${displacementId}) ` : ''}blur(28px) saturate(1.55) contrast(1.04)`;

  return (
    <>
      {trySafariDisplacement && (
        <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
          <defs>
            <filter id={displacementId} x="-20%" y="-20%" width="140%" height="140%" filterUnits="objectBoundingBox">
              <feTurbulence type="fractalNoise" baseFrequency="0.011 0.017" numOctaves="3" seed="7" result="n" />
              <feGaussianBlur in="n" stdDeviation="0.8" result="ns" />
              <feDisplacementMap in="SourceGraphic" in2="ns" xChannelSelector="R" yChannelSelector="G" scale="14" />
            </filter>
          </defs>
        </svg>
      )}

      <div
        className={`relative overflow-hidden ${className}`}
        style={{
          width,
          height,
          borderRadius: radius,
                 
          backdropFilter: backdropValue,
          WebkitBackdropFilter: webkitBackdropValue,
                
          boxShadow: shadow,
               
          opacity: visible ? 1 : 0,
          transform: visible ? 'scale(1)' : 'scale(.98)',
          transition: 'opacity .2s, transform .2s',
          ...style,
        }}
      >
        {                        }
        <span
          className="pointer-events-none absolute inset-0"
          style={{
            borderRadius: radius,
                                          
            background: isDark
              ? 'linear-gradient(180deg, rgba(22,24,27,0.50), rgba(22,24,27,0.35))'
              : 'linear-gradient(180deg, rgba(255,255,255,0.65), rgba(255,255,255,0.35))',
            opacity: glassOpacity,
          }}
        />

        {                                 }
        {vibrancy && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              borderRadius: radius,
                             
              background: isDark
                ? 'linear-gradient(135deg, rgba(120,150,255,0.18), rgba(255,120,220,0.08))'
                : 'linear-gradient(135deg, rgba(140,180,255,0.28), rgba(255,160,220,0.18))',
              mixBlendMode: 'screen',
              opacity: vibrancyOpacity,
            }}
          />
        )}

        {          }
        {showSpecular && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              borderRadius: radius,
              background:
                'linear-gradient(to bottom, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.25) 36%, rgba(255,255,255,0) 66%)',
              mixBlendMode: 'screen',
              opacity: specularOpacity,
            }}
          />
        )}

        {             }
        {showStroke && (
          <span
            className="pointer-events-none absolute inset-0"
            style={{
              borderRadius: radius,
              boxShadow: `inset 0 0 0 1px ${stroke}`,
            }}
          />
        )}

        {        }
        <div className="relative z-[1] w-full h-full">{children}</div>
      </div>
    </>
  );
};

export default LiquidGlass;
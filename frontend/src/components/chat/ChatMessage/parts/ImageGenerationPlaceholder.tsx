import { resolveAssetUrl } from '../../../../utils/asset-url';
                                                                                
import { useLocalize } from '../../../../localization/useLocalize';
import ImageGenerationBlackHoleCanvas
  from '../../../../common/ImageGenerationBlackHoleCanvas';

export default function ImageGenerationPlaceholder() {
  const localize = useLocalize();
  return (
    <div
      className="
        seekmore-image-generation-flow
        absolute inset-0
        overflow-hidden
      "
      style={{
        width: '100%',
        height: '100%',
        isolation: 'isolate',
      }}
      aria-label={localize('chat.image.generating')}
      role="status"
    >
      <style>{`
        @keyframes seekmore-image-logo-opacity {
          0%,
          100% {
            opacity: 0.38;
          }

          50% {
            opacity: 0.88;
          }
        }

        .seekmore-image-generation-flow__logo {
          animation:
            seekmore-image-logo-opacity
            2.4s
            ease-in-out
            infinite;
        }

        @media (prefers-reduced-motion: reduce) {
          .seekmore-image-generation-flow__logo {
            animation: none !important;
            opacity: 0.7;
          }
        }
      `}</style>

      <ImageGenerationBlackHoleCanvas />

      <div
        aria-hidden="true"
        style={{
          position: 'absolute',
          inset: 0,
          zIndex: 10,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          lineHeight: 0,
          pointerEvents: 'none',
        }}
      >
        <img
          src={resolveAssetUrl('/logo.svg')}
          alt=""
          draggable={false}
          className="
            seekmore-image-generation-flow__logo
            select-none
          "
          style={{
            display: 'block',
            width: 'auto',
            height: '5px',
            maxWidth: '80%',
            maxHeight: '80%',
            margin: 0,
            padding: 0,
            flex: '0 0 auto',
            objectFit: 'contain',
            objectPosition: 'center',
            filter: 'brightness(0) invert(1)',
          }}
        />
      </div>
    </div>
  );
}
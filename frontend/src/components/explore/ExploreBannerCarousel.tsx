import { resolveAssetUrl } from '../../utils/asset-url';
                                                            
import {
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useLocalize } from '../../localization/useLocalize';
const BANNER_NAMES = [
  'banner1',
  'banner2',
  'banner3',
  'banner4',
] as const;

const BANNER_EXTENSIONS = [
  'png',
  'jpg',
  'jpeg',
  'webp',
  'svg',
] as const;

function ExploreBannerImage({
  name,
  active,
}: {
  name: (typeof BANNER_NAMES)[number];
  active: boolean;
}) {
  const candidates = useMemo(
    () => [
      ...BANNER_EXTENSIONS.map(
        (extension) =>
          resolveAssetUrl(`/banner/${name}.${extension}`),
      ),
      resolveAssetUrl(`/banner/${name}`),
    ],
    [name],
  );

  const [
    candidateIndex,
    setCandidateIndex,
  ] = useState(0);

  return (
    <img
      src={candidates[candidateIndex]}
      alt=""
      aria-hidden={!active}
      draggable={false}
      onError={() => {
        setCandidateIndex(
          (current) =>
            current < candidates.length - 1
              ? current + 1
              : current,
        );
      }}
      className={`
        pointer-events-none
        block
        w-full
        max-w-full
        select-none
        object-contain
        transition-opacity
        duration-[1400ms]
        ease-in-out
        ${
          active
            ? `
              relative
              h-auto
              opacity-100
            `
            : `
              absolute
              inset-0
              h-full
              opacity-0
            `
        }
      `}
    />
  );
}

export default function ExploreBannerCarousel({
  }: {

}) {
  const localize = useLocalize();
  const [
    activeIndex,
    setActiveIndex,
  ] = useState(0);

  useEffect(() => {
    const timer =
      window.setInterval(() => {
        setActiveIndex(
          (current) =>
            (current + 1)
            % BANNER_NAMES.length,
        );
      }, 10_000);

    return () =>
      window.clearInterval(timer);
  }, []);

  return (
    <section
      aria-label={localize('explore.banner.ariaLabel')}
      className={`
        relative
        w-full
        min-w-0
        max-w-full
        overflow-hidden
        overscroll-x-none
        touch-pan-y
        rounded-[24px]
        select-none
        ${
          'bg-[#eeeeee] dark:bg-[#222222]'
        }
      `}
    >
      {BANNER_NAMES.map(
        (name, index) => (
          <ExploreBannerImage
            key={name}
            name={name}
            active={
              index === activeIndex
            }
          />
        ),
      )}
    </section>
  );
}
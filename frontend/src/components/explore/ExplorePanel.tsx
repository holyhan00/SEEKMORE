                                                   

import {
  useEffect,
  useRef,
  useState,
} from 'react';

import ExploreAgentPage
  from './agent/ExploreAgentPage';
import ExploreBannerCarousel
  from './ExploreBannerCarousel';
import ExploreOverviewPage
  from './overview/ExploreOverviewPage';
import SearchBar from './SearchBar';
import ExploreSkillPage
  from './skill/ExploreSkillPage';
import ExploreTabs from './ExploreTabs';

import type {
  ExploreCategory,
  ExploreTab,
} from './explore.types';

function isExploreCategory(
  value: unknown,
): value is ExploreCategory {
  return (
    value === 'AGENT'
    || value === 'SKILL'
  );
}

export default function ExplorePanel({
  }: {

}) {
  const [tab, setTab] =
    useState<ExploreTab>(
      'OVERVIEW',
    );

  const [query, setQuery] =
    useState('');

  const contentRef =
    useRef<HTMLElement | null>(
      null,
    );

  useEffect(() => {
    const navigate = (
      event: Event,
    ) => {
      const detail = (
        event as CustomEvent<{
          category?: unknown;
        }>
      ).detail;

      if (
        !isExploreCategory(
          detail?.category,
        )
      ) {
        return;
      }

      setTab(detail.category);
      setQuery('');
    };

    window.addEventListener(
      'explore:navigate',
      navigate,
    );

    return () =>
      window.removeEventListener(
        'explore:navigate',
        navigate,
      );
  }, []);

  useEffect(() => {
    contentRef.current?.scrollTo({
      top: 0,
    });
  }, [tab]);

  const selectTab = (
    next: ExploreTab,
  ) => {
    setTab(next);
    setQuery('');
  };

  return (
    <div
      className={`
        relative
        flex
        h-full
        min-h-0
        min-w-0
        w-full
        flex-col
        overflow-hidden
        select-none
        ${
          'bg-[#f7f7f7] text-[#202020] dark:bg-[#191919] dark:text-[#f7f7f7]'
        }
      `}
    >
      <main
        ref={contentRef}
        className="
          scroll-container
          min-h-0
          min-w-0
          flex-1
          overflow-x-hidden
          overflow-y-auto
          overscroll-contain
        "
      >
        <div
          className="
            mx-auto
            w-[95%]
            max-w-[760px]
            min-w-0
            pb-[90px]
            pt-[10px]
          "
        >
          <ExploreBannerCarousel

          />

          <div className="mt-[10px]">
            <ExploreTabs
              active={tab}

              onChange={
                selectTab
              }
            />
          </div>

          <div
            className="
              w-full
              min-w-0
            "
          >
            {tab === 'OVERVIEW' && (
              <ExploreOverviewPage
                query={query}

              />
            )}

            {tab === 'AGENT' && (
              <ExploreAgentPage
                query={query}

              />
            )}

            {tab === 'SKILL' && (
              <ExploreSkillPage
                query={query}

              />
            )}
          </div>
        </div>
      </main>

      <div
        className="
          pointer-events-auto
          absolute
          bottom-[10px]
          left-1/2
          z-30
          w-[95%]
          max-w-[760px]
          min-w-0
          -translate-x-1/2
        "
      >
        <SearchBar
          value={query}

          onChange={
            setQuery
          }
        />
      </div>
    </div>
  );
}
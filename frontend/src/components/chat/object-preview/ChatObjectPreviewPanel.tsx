// frontend/src/components/chat/object-preview/ChatObjectPreviewPanel.tsx
import {
  useEffect,
  useState,
} from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Maximize2,
  Minimize2,
  X,
} from 'lucide-react';
import { useLocalize } from '../../../localization/useLocalize';
import { useDesktopRuntime } from '../../../runtime/desktop/useDesktopRuntime';
import {
  downloadObjectFile,
  getObjectPreviewManifest,
} from './object-preview.client';
import { useObjectPreview } from './ObjectPreviewProvider';
import ObjectPreviewRenderer from './ObjectPreviewRenderer';
import type { ObjectPreviewManifest } from './object-preview.types';

const OBJECT_PREVIEW_WIDTH = 360;
const OBJECT_PREVIEW_MIN_WIDTH = 280;

export default function ChatObjectPreviewPanel() {
  const localize = useLocalize();
  const desktopRuntime = useDesktopRuntime();

  const {
    open,
    selectedObject,
    objects,
    close,
    selectObject,
  } = useObjectPreview();

  const [manifest, setManifest] =
    useState<ObjectPreviewManifest | null>(null);

  const [loading, setLoading] =
    useState(false);

  const [error, setError] =
    useState(false);

  const [focused, setFocused] =
    useState(false);

  const [
    desktopDockWidth,
    setDesktopDockWidth,
  ] = useState<number | null>(null);

  useEffect(() => {
    setManifest(null);
    setError(false);

    if (!open || !selectedObject?.objectId) {
      setFocused(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);

    void getObjectPreviewManifest(
      selectedObject.objectId,
    )
      .then((nextManifest) => {
        if (!cancelled) {
          setManifest(nextManifest);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    open,
    selectedObject?.objectId,
  ]);

  useEffect(() => {
    setDesktopDockWidth(null);

    if (
      !open
      || !desktopRuntime.isDesktop
      || !desktopRuntime.bridgeReady
    ) {
      return;
    }

    const windowBridge =
      window.seekmoreDesktop?.window;

    if (!windowBridge) {
      return;
    }

    let cancelled = false;

    void windowBridge
      .expandObjectPreview(
        OBJECT_PREVIEW_WIDTH,
      )
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (
          result.expanded === true
          && result.previewWidth
            >= OBJECT_PREVIEW_MIN_WIDTH
        ) {
          setDesktopDockWidth(
            result.previewWidth,
          );
          return;
        }

        setDesktopDockWidth(null);
      })
      .catch(() => {
        if (!cancelled) {
          setDesktopDockWidth(null);
        }
      });

    return () => {
      cancelled = true;

      setDesktopDockWidth(null);

      void windowBridge
        .restoreObjectPreview()
        .catch(() => undefined);
    };
  }, [
    desktopRuntime.bridgeReady,
    desktopRuntime.isDesktop,
    open,
  ]);

  if (!open || !selectedObject) {
    return null;
  }

  const selectedIndex = Math.max(
    0,
    objects.findIndex(
      (object) =>
        object.objectId
        === selectedObject.objectId,
    ),
  );

  const selectRelative = (
    offset: number,
  ) => {
    if (!objects.length) {
      return;
    }

    const index = (
      selectedIndex
      + offset
      + objects.length
    ) % objects.length;

    const next = objects[index];

    if (next) {
      selectObject(next.objectId);
    }
  };

  const desktopDocked =
    desktopDockWidth !== null;

  if (
    desktopRuntime.isDesktop
    && !desktopDocked
  ) {
    return null;
  }

  const webPositionClass =
    'absolute inset-y-0 right-0 z-[80] xl:relative xl:inset-auto xl:z-auto xl:shrink-0 xl:shadow-none';

  return (
    <aside
      style={focused
        ? {
            width: 'calc(100vw - 24px)',
            minWidth: 0,
          }
        : {
            width: desktopDocked
              ? desktopDockWidth
              : `min(${OBJECT_PREVIEW_WIDTH}px, calc(100% - 40px))`,

            minWidth: desktopDocked
              ? OBJECT_PREVIEW_MIN_WIDTH
              : undefined,

            flexBasis: desktopDocked
              ? desktopDockWidth
              : undefined,
          }}
      className={[
        'flex min-w-0 flex-col bg-surface-base shadow-[-10px_0_30px_rgba(0,0,0,0.6)] dark:shadow-[-10px_0_30px_rgba(0,0,0,0.18)]',
        focused
          ? 'fixed inset-3 z-[120] rounded-[14px] border border-[#000000]/[0.08] shadow-2xl dark:border-[#ffffff]/[0.1]'
          : desktopRuntime.isDesktop
            ? 'relative z-auto shrink-0 shadow-none'
            : webPositionClass,
      ].join(' ')}
    >
      <header className="flex h-[45px] shrink-0 items-center gap-2 px-3">
        <div className="min-w-0  flex-1 pr-[20px]">
          <div className="truncate text-[12px] font-medium">
            {selectedObject.displayName}
          </div>

          <div className="truncate text-[9px] opacity-40">
            {selectedObject.extension
              || selectedObject.objectKind}
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            void downloadObjectFile(
              selectedObject.downloadUrl,
              selectedObject.originalName
                ?? selectedObject.displayName,
            ).catch((downloadError) => {
              console.warn(
                '[ObjectPreview] download failed:',
                downloadError,
              );
            });
          }}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md p-0 text-[#000000]/55 transition hover:bg-[#000000]/[0.05] hover:text-[#000000] dark:text-[#ffffff]/55 dark:hover:bg-[#ffffff]/[0.07] dark:hover:text-[#ffffff]"
          title={localize(
            'object.preview.download',
          )}
        >
          <Download
            size={14}
            strokeWidth={1.8}
            className="shrink-0"
          />
        </button>

        <button
          type="button"
          onClick={() => setFocused((value) => !value)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md p-0 opacity-55 transition hover:bg-[#000000]/[0.05] hover:opacity-100 dark:hover:bg-[#ffffff]/[0.07]"
          title={localize(
            focused
              ? 'object.preview.restore'
              : 'object.preview.expand',
          )}
        >
          {focused ? (
            <Minimize2 size={14} className="shrink-0" />
          ) : (
            <Maximize2 size={14} className="shrink-0" />
          )}
        </button>

        <button
          type="button"
          onClick={close}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md p-0 opacity-55 transition hover:bg-[#000000]/[0.05] hover:opacity-100 dark:hover:bg-[#ffffff]/[0.07]"
          title={localize(
            'object.preview.close',
          )}
        >
          <X
            size={14}
            className="shrink-0"
          />
        </button>
      </header>

      {objects.length > 1 && (
        <div className="flex h-8 shrink-0 items-center justify-center gap-2 border-b border-[#000000]/[0.05] text-[10px] dark:border-[#ffffff]/[0.05]">
          <button
            type="button"
            onClick={() =>
              selectRelative(-1)
            }
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-0 opacity-45 hover:opacity-100"
            title={localize(
              'object.preview.previous',
            )}
          >
            <ChevronLeft
              size={13}
              className="shrink-0"
            />
          </button>

          <span className="min-w-[42px] text-center opacity-55">
            {localize(
              'object.preview.index',
              {
                current:
                  selectedIndex + 1,
                total:
                  objects.length,
              },
            )}
          </span>

          <button
            type="button"
            onClick={() =>
              selectRelative(1)
            }
            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md p-0 opacity-45 hover:opacity-100"
            title={localize(
              'object.preview.next',
            )}
          >
            <ChevronRight
              size={13}
              className="shrink-0"
            />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs opacity-40">
            {localize(
              'object.preview.loading',
            )}
          </div>
        ) : error || !manifest ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs opacity-40">
            {localize(
              'object.preview.failed',
            )}
          </div>
        ) : (
          <ObjectPreviewRenderer
            manifest={manifest}
          />
        )}
      </div>
    </aside>
  );
}
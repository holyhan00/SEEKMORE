// frontend/src/main.tsx
import React, { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RecoilRoot } from 'recoil';
import './index.css';
import App from './App.tsx';
import { DesktopRuntimeProvider } from './runtime/desktop/DesktopRuntimeProvider';
import { AuthProvider } from './hooks/auth/useAuth';
import { LocalizationProvider } from './localization/LocalizationProvider';
import { LocalizationAccountSync } from './localization/LocalizationAccountSync';
import { AppearanceProvider } from './theme/AppearanceProvider';
import { initializeAppearance } from './theme/appearance.storage';


class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return {
      error:
        error instanceof Error
          ? error.message
          : String(error ?? 'Unknown renderer error'),
    };
  }

  componentDidCatch(
    error: Error,
    errorInfo: React.ErrorInfo,
  ) {
    console.error(
      '[RendererRoot] React root failed',
      error,
      errorInfo,
    );
  }

  render() {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxSizing: 'border-box',
          padding: 32,
          background: '#0f0f10',
          color: '#ffffff',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: 'min(520px, 100%)',
            textAlign: 'center',
          }}
        >
          <div
            style={{
              marginBottom: 10,
              fontSize: 15,
              fontWeight: 600,
            }}
          >
            SEEKMORE 渲染器发生异常
          </div>

          <div
            style={{
              marginBottom: 18,
              color: '#b8b8b8',
              fontSize: 12,
              lineHeight: 1.6,
              wordBreak: 'break-word',
            }}
          >
            {this.state.error}
          </div>

          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              border: 0,
              borderRadius: 8,
              padding: '8px 14px',
              background: '#ffffff',
              color: '#000000',
              cursor: 'pointer',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }
}

window.addEventListener(
  'error',
  (event) => {
    console.error(
      '[RendererRoot] Uncaught window error',
      event.error ?? event.message,
    );
  },
);

window.addEventListener(
  'unhandledrejection',
  (event) => {
    console.error(
      '[RendererRoot] Unhandled promise rejection',
      event.reason,
    );
  },
);

try {
  initializeAppearance();
} catch (error) {
  console.error(
    '[RendererRoot] Appearance initialization failed',
    error,
  );
}

createRoot(document.getElementById('root')!).render(
  <RootErrorBoundary>
    <StrictMode>
    <AppearanceProvider>
      <LocalizationProvider>
      <RecoilRoot>
        <DesktopRuntimeProvider>
          <AuthProvider>
            <LocalizationAccountSync>
              <App />
            </LocalizationAccountSync>
          </AuthProvider>
        </DesktopRuntimeProvider>
      </RecoilRoot>
      </LocalizationProvider>
    </AppearanceProvider>
    </StrictMode>
  </RootErrorBoundary>,
);

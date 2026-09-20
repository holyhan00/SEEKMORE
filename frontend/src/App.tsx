import {
  lazy,
  Suspense,
} from 'react';
import {
  BrowserRouter,
  HashRouter,
  Navigate,
  Route,
  Routes,
} from 'react-router-dom';

import { TimeReminderProvider } from './components/chat/time/TimeReminderProvider';
import { useAuth } from './hooks/auth/useAuth';
import { useLocalize } from './localization/useLocalize';
import StartupScreen from './pages/StartupScreen';
import { useDesktopRuntime } from './runtime/desktop/useDesktopRuntime';

const Home = lazy(
  () => import('./pages/Home'),
);

const Root = () => {
  const {
    isLoggedIn,
    authReady,
    sessionState,
    retrySession,
  } = useAuth();

  const desktopRuntime =
    useDesktopRuntime();

  const t = useLocalize();

  const bridgeError =
    desktopRuntime.phase
      === 'desktop-bridge-error'
      ? desktopRuntime.error
          ?.message
        ?? t(
          'app.desktopBridgeFailed',
        )
      : null;

  const sessionReady =
    authReady
    && isLoggedIn
    && sessionState === 'ready';

  return (
    <>
      <div
        className={`h-full w-full overflow-hidden ${
          desktopRuntime.isDesktop
            ? 'bg-transparent'
            : 'bg-[#0f0f10]'
        }`}
      >
        {!sessionReady && (
          <StartupScreen
            error={
              sessionState === 'error'
            }
            onRetry={() => {
              void retrySession();
            }}
          />
        )}

        {sessionReady && (
          <TimeReminderProvider>
            <Suspense
              fallback={
                <StartupScreen />
              }
            >
              <Home />
            </Suspense>
          </TimeReminderProvider>
        )}

        {bridgeError && (
          <div
            data-desktop-no-drag
            role="alert"
            className="fixed left-1/2 top-3 z-[100002] -translate-x-1/2 rounded-[10px] bg-red-600 px-4 py-2 text-[12px] font-medium text-[#ffffff] shadow-lg"
          >
            {bridgeError}
          </div>
        )}
      </div>

      <div id="shell-portal" />
    </>
  );
};

const Router =
  window.location.protocol
    === 'file:'
    ? HashRouter
    : BrowserRouter;

const App = () => (
  <Router>
    <Routes>
      <Route
        path="/"
        element={<Root />}
      />

      <Route
        path="*"
        element={
          <Navigate
            to="/"
            replace
          />
        }
      />
    </Routes>
  </Router>
);

export default App;

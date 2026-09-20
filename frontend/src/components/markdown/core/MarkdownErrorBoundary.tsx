import { localizeText } from '../../../localization/localization';
import { Component, ReactNode } from'react';
import { sendErrorLog, ErrorInfo } from '../utils/errorLogger';                        
import { MarkdownErrorBlock } from './MarkdownErrorBlock';

                                                    
interface ErrorBoundaryProps {
  componentName: string;
  fallback?: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class MarkdownErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    sendErrorLog({
      error,
      errorInfo,
      component: this.props.componentName,
      timestamp: new Date().toISOString()
    });
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <MarkdownErrorBlock
          title={`${this.props.componentName} ${localizeText('markdown.error.defaultTitle')}`}
          message={this.state.error?.message || localizeText('markdown.error.unknown')}
        />
      );
    }

    return this.props.children;
  }
}

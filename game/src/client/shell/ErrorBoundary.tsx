/**
 * Error boundary around every hosted screen: a crash in one screen shows a framed error card (with
 * Retry) instead of blanking the whole game, and is logged for bug reports.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { t } from '../i18n/index';

interface Props {
  /** What is being hosted (for the log and the card). */
  where: string;
  children: ReactNode;
  /** Optional action offered on the card (e.g. close the route). */
  onDismiss?(): void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[shell] ${this.props.where} crashed`, error, info.componentStack);
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="error-card" role="alert" data-testid="error-card">
        <h2>{t('ui.error.title')}</h2>
        <p>{t('ui.error.body', { where: this.props.where })}</p>
        <pre>{error.message}</pre>
        <div className="btn-row btn-row-end">
          {this.props.onDismiss && (
            <button type="button" className="btn btn-secondary btn-md" onClick={this.props.onDismiss}>
              <span className="btn-label">{t('ui.common.close')}</span>
            </button>
          )}
          <button type="button" className="btn btn-primary btn-md" onClick={() => this.setState({ error: null })}>
            <span className="btn-label">{t('ui.error.retry')}</span>
          </button>
        </div>
      </div>
    );
  }
}

import CircuitBreaker from 'opossum';
import type {Logger} from './logger.js';

/** When a circuit opens and how long it stays open. */
export interface CircuitSettings {
  /** Percentage of failed requests, within the window, that opens the circuit. */
  errorThresholdPercentage: number;
  /** Requests needed in the window before the percentage counts. */
  volumeThreshold: number;
  /** Time the circuit stays open before one trial request goes through. */
  resetTimeoutMs: number;
  /**
   * Rolling window of the statistics. A request counts when it starts and its failure when it
   * ends, so the window must outlast the upstream timeout or slow failures never open the circuit.
   */
  windowMs: number;
}

/** A forwarded request: settles when the upstream answers or fails. */
export type Call = () => Promise<void>;

/**
 * One circuit breaker per upstream URL, shared by every route it serves: while the monolith serves
 * four services, one failing monolith opens one circuit for all of them, and an extracted service
 * gets a circuit of its own.
 */
export class UpstreamCircuits {
  private readonly breakers = new Map<string, CircuitBreaker<[Call], void>>();

  constructor(
    readonly settings: CircuitSettings,
    private readonly logger: Logger,
  ) {}

  for(upstream: string): CircuitBreaker<[Call], void> {
    let breaker = this.breakers.get(upstream);
    if (!breaker) {
      breaker = new CircuitBreaker((call: Call) => call(), {
        name: upstream,
        // The proxy enforces the upstream timeout; a breaker timeout would race with it.
        timeout: false,
        errorThresholdPercentage: this.settings.errorThresholdPercentage,
        volumeThreshold: this.settings.volumeThreshold,
        resetTimeout: this.settings.resetTimeoutMs,
        rollingCountTimeout: this.settings.windowMs,
      });
      breaker.on('open', () =>
        this.logger.warn({upstream}, 'Circuit opened, upstream calls stopped'),
      );
      breaker.on('halfOpen', () =>
        this.logger.info({upstream}, 'Circuit half open, trying the upstream'),
      );
      breaker.on('close', () =>
        this.logger.info({upstream}, 'Circuit closed, upstream is back'),
      );
      this.breakers.set(upstream, breaker);
    }
    return breaker;
  }

  state(upstream: string): 'CLOSED' | 'OPEN' | 'HALF_OPEN' {
    const breaker = this.for(upstream);
    if (breaker.halfOpen) {
      return 'HALF_OPEN';
    }
    return breaker.opened ? 'OPEN' : 'CLOSED';
  }
}

// @ts-nocheck — vendored bot code with known upstream type gaps; see AGENTS.md
import React from 'react';
import { observer } from 'mobx-react-lite';
import { useStore } from '@/hooks/useStore';
import { api_base } from '@/external/bot-skeleton';
import { botNotification } from '@/components/bot-notification/bot-notification';
import { localize } from '@deriv-com/translations';
import './automated.scss';

// Volatility indices — only non-1s markets (2s and 5s ticks)
// Real Deriv volatility indices (sourced from the existing bot builder codebase)
const VOLATILITY_INDICES = [
    // Standard volatility indices (2s/5s tick intervals)
    { symbol: 'R_10', name: 'Volatility 10 Index' },
    { symbol: 'R_25', name: 'Volatility 25 Index' },
    { symbol: 'R_50', name: 'Volatility 50 Index' },
    { symbol: 'R_75', name: 'Volatility 75 Index' },
    { symbol: 'R_100', name: 'Volatility 100 Index' },
    // 1-second volatility indices
    { symbol: '1HZ10V', name: 'Volatility 10 (1s) Index' },
    { symbol: '1HZ25V', name: 'Volatility 25 (1s) Index' },
    { symbol: '1HZ50V', name: 'Volatility 50 (1s) Index' },
    { symbol: '1HZ75V', name: 'Volatility 75 (1s) Index' },
    { symbol: '1HZ100V', name: 'Volatility 100 (1s) Index' },
    { symbol: '1HZ150V', name: 'Volatility 150 (1s) Index' },
    { symbol: '1HZ200V', name: 'Volatility 200 (1s) Index' },
    { symbol: '1HZ250V', name: 'Volatility 250 (1s) Index' },
    { symbol: '1HZ300V', name: 'Volatility 300 (1s) Index' },
];

// Individual contract types available for volatility indices
const TRADE_TYPE_OPTIONS = [
    { text: 'Rise', value: 'CALL' },
    { text: 'Fall', value: 'PUT' },
    { text: 'Even', value: 'DIGITEVEN' },
    { text: 'Odd', value: 'DIGITODD' },
];

type MarketStatus = {
    symbol: string;
    name: string;
    is_active: boolean;
    selected: boolean;
};

type TradeRecord = {
    id: string;
    symbol: string;
    contract_type: string;
    stake: number;
    result: 'win' | 'loss' | 'pending';
    profit: number;
    buy_price: number;
    sell_price: number;
    contract_id: string;
    timestamp: Date;
};

type MartingaleStrategy = 'martingale' | 'dalembert' | 'oscars_grind' | 'reverse_martingale';

type TickDigitRecord = {
    digit: number;
    quote: number;
    epoch: number;
    symbol: string;
};

type MarketDigitStats = {
    symbol: string;
    name: string;
    distribution: number[]; // count per digit 0-9
    total_ticks: number;
    recent_digits: TickDigitRecord[]; // last 50 ticks
};

// ---- Trade engine class used by the Automated page ----
class AutomatedTradeEngine {
    api: any;
    is_running = false;
    should_stop = false;
    active_contracts: Map<string, { contract_id: string; symbol: string; stake: number }> = new Map();
    message_subscription: any = null;

    constructor(api: any) {
        this.api = api;
    }

    start() {
        this.is_running = true;
        this.should_stop = false;
        this.listenForContractUpdates();
    }

    stop() {
        this.should_stop = true;
        this.is_running = false;
        this.message_subscription?.unsubscribe?.();
        this.message_subscription = null;
    }

    // Subscribe to proposal_open_contract messages to track open contracts
    listenForContractUpdates() {
        if (this.message_subscription) return;
        this.message_subscription = this.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type === 'proposal_open_contract') {
                const contract = data.proposal_open_contract;
                if (!contract) return;
                // Emit an event so the React component can react
                window.dispatchEvent(
                    new CustomEvent('automated_contract_update', { detail: contract })
                );
            }
        });
    }

    // Request a proposal from the Deriv API
    async requestProposal(
        symbol: string,
        contract_type: string,
        amount: number,
        currency: string,
        duration: number,
        duration_unit: string
    ): Promise<{ id: string; ask_price: number; payout: number } | null> {
        try {
            const response = await this.api.send({
                proposal: 1,
                amount,
                basis: 'stake',
                contract_type,
                currency,
                duration,
                duration_unit,
                underlying_symbol: symbol,
            });

            if (response?.error) {
                console.warn(`Proposal error for ${symbol}:`, response.error.message);
                return null;
            }
            if (response?.proposal) {
                return {
                    id: response.proposal.id,
                    ask_price: Number(response.proposal.ask_price),
                    payout: Number(response.proposal.payout),
                };
            }
            return null;
        } catch (err) {
            console.error(`Proposal request failed for ${symbol}:`, err);
            return null;
        }
    }

    // Buy a contract using the proposal id
    async buyContract(
        proposal_id: string,
        price: number
    ): Promise<{ contract_id: string; transaction_id: string; buy_price: number } | null> {
        try {
            const response = await this.api.send({ buy: proposal_id, price });

            if (response?.error) {
                console.warn('Buy error:', response.error.message);
                return null;
            }
            if (response?.buy) {
                return {
                    contract_id: response.buy.contract_id,
                    transaction_id: response.buy.transaction_id,
                    buy_price: Number(response.buy.buy_price),
                };
            }
            return null;
        } catch (err) {
            console.error('Buy request failed:', err);
            return null;
        }
    }

    // Execute a full trade: proposal → buy → returns buy info
    async executeTrade(
        symbol: string,
        contract_type: string,
        amount: number,
        currency: string,
        duration: number,
        duration_unit: string
    ): Promise<{ contract_id: string; buy_price: number; transaction_id: string } | null> {
        const proposal = await this.requestProposal(
            symbol,
            contract_type,
            amount,
            currency,
            duration,
            duration_unit
        );
        if (!proposal) return null;

        const buy_result = await this.buyContract(proposal.id, proposal.ask_price);
        if (!buy_result) return null;

        this.active_contracts.set(buy_result.contract_id, {
            contract_id: buy_result.contract_id,
            symbol,
            stake: amount,
        });

        return buy_result;
    }
}

// ---- React Component ----
const Automated = observer(() => {
    const { client } = useStore();
    const engineRef = React.useRef<AutomatedTradeEngine | null>(null);
    const trade_loop_ref = React.useRef<NodeJS.Timeout | null>(null);

    const [is_running, setIsRunning] = React.useState(false);
    const [is_connected, setIsConnected] = React.useState(false);
    const [stake, setStake] = React.useState(1);
    const [martingale_size, setMartingaleSize] = React.useState(2);
    const [martingale_strategy, setMartingaleStrategy] = React.useState<MartingaleStrategy>('martingale');
    const [take_profit, setTakeProfit] = React.useState(50);
    const [stop_loss, setStopLoss] = React.useState(100);
    const [trade_type, setTradeType] = React.useState('CALL');
    const [duration, setDuration] = React.useState(5);
    const [duration_unit, setDurationUnit] = React.useState('t');
    const [market_statuses, setMarketStatuses] = React.useState<MarketStatus[]>(
        VOLATILITY_INDICES.map(idx => ({
            symbol: idx.symbol,
            name: idx.name,
            is_active: true,
            selected: true,
        }))
    );
    const [trade_history, setTradeHistory] = React.useState<TradeRecord[]>([]);
    const [total_profit, setTotalProfit] = React.useState(0);
    const [current_stake, setCurrentStake] = React.useState(stake);
    const [loss_streak, setLossStreak] = React.useState(0);
    const [active_trade_count, setActiveTradeCount] = React.useState(0);
    const [market_digit_stats, setMarketDigitStats] = React.useState<Record<string, MarketDigitStats>>({});
    const tick_subscriptions_ref = React.useRef<any[]>([]);

    // Refs for values needed inside callbacks/loops without stale closures
    const stateRef = React.useRef({
        is_running: false,
        current_stake: stake,
        total_profit: 0,
        loss_streak: 0,
        stake,
        martingale_size,
        martingale_strategy,
        take_profit,
        stop_loss,
        duration,
        duration_unit,
    });

    // Keep refs in sync
    React.useEffect(() => {
        stateRef.current.current_stake = current_stake;
    }, [current_stake]);
    React.useEffect(() => { stateRef.current.total_profit = total_profit; }, [total_profit]);
    React.useEffect(() => { stateRef.current.loss_streak = loss_streak; }, [loss_streak]);
    React.useEffect(() => { stateRef.current.stake = stake; }, [stake]);
    React.useEffect(() => { stateRef.current.martingale_size = martingale_size; }, [martingale_size]);
    React.useEffect(() => { stateRef.current.martingale_strategy = martingale_strategy; }, [martingale_strategy]);
    React.useEffect(() => { stateRef.current.take_profit = take_profit; }, [take_profit]);
    React.useEffect(() => { stateRef.current.stop_loss = stop_loss; }, [stop_loss]);
    React.useEffect(() => { stateRef.current.duration = duration; }, [duration]);
    React.useEffect(() => { stateRef.current.duration_unit = duration_unit; }, [duration_unit]);
    React.useEffect(() => { stateRef.current.is_running = is_running; }, [is_running]);

    // Check API connection on mount
    React.useEffect(() => {
        const checkConnection = () => {
            const connected = api_base?.api?.connection?.readyState === WebSocket.OPEN;
            setIsConnected(connected);
        };
        checkConnection();
        const interval = setInterval(checkConnection, 3000);
        return () => clearInterval(interval);
    }, []);

    // ---- Last Digit Analysis: tick subscriptions ----
    const getLastDigit = (quote: number, pip_size: number): number => {
        const str = quote.toFixed(pip_size);
        return parseInt(str[str.length - 1], 10);
    };

    const startTickSubscriptions = React.useCallback(() => {
        if (!api_base?.api || api_base.api.connection?.readyState !== WebSocket.OPEN) return;
        // Stop any existing subscriptions first
        stopTickSubscriptions();

        const selected = market_statuses.filter(m => m.selected);
        // Initialize stats for each selected market
        const initial_stats: Record<string, MarketDigitStats> = {};
        selected.forEach(m => {
            initial_stats[m.symbol] = {
                symbol: m.symbol,
                name: m.name,
                distribution: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
                total_ticks: 0,
                recent_digits: [],
            };
        });
        setMarketDigitStats(initial_stats);

        // Subscribe to live ticks for each selected market
        selected.forEach(m => {
            const subscription = api_base.api.send({ ticks: m.symbol, subscribe: 1 });
            if (subscription) {
                tick_subscriptions_ref.current.push(subscription);
            }
        });

        // Listen for tick messages
        const message_sub = api_base.api.onMessage().subscribe(({ data }: any) => {
            if (data?.msg_type !== 'tick') return;
            const tick = data.tick;
            if (!tick?.quote || !tick?.symbol) return;

            const symbol = tick.symbol;
            // Use the pip_size from the API's active symbols data, default to 2 for volatility indices
            const pip_size = api_base?.pip_sizes?.[symbol] ?? 2;
            const digit = getLastDigit(tick.quote, pip_size);

            setMarketDigitStats(prev => {
                const existing = prev[symbol];
                if (!existing) return prev;
                const new_distribution = [...existing.distribution];
                new_distribution[digit] += 1;
                const new_record: TickDigitRecord = {
                    digit,
                    quote: tick.quote,
                    epoch: tick.epoch,
                    symbol,
                };
                const new_recent = [new_record, ...existing.recent_digits].slice(0, 50);
                return {
                    ...prev,
                    [symbol]: {
                        ...existing,
                        distribution: new_distribution,
                        total_ticks: existing.total_ticks + 1,
                        recent_digits: new_recent,
                    },
                };
            });
        });
        tick_subscriptions_ref.current.push(message_sub);
    }, [market_statuses]);

    const stopTickSubscriptions = React.useCallback(() => {
        tick_subscriptions_ref.current.forEach(sub => {
            if (sub?.unsubscribe) sub.unsubscribe();
            else if (sub?.id && api_base?.api) api_base.api.send({ forget: sub.id });
        });
        tick_subscriptions_ref.current = [];
    }, []);

    // Start tick subscriptions when markets change or on mount
    React.useEffect(() => {
        if (is_connected) {
            startTickSubscriptions();
        }
        return () => stopTickSubscriptions();
    }, [is_connected, market_statuses.map(m => m.selected).join(','), startTickSubscriptions, stopTickSubscriptions]);

    // Listen for contract settlement events from the engine
    React.useEffect(() => {
        const handleContractUpdate = (e: Event) => {
            const contract = (e as CustomEvent).detail;
            if (!contract) return;

            // Contract settled
            if (contract.status === 'expired' || contract.status === 'sold') {
                const contract_id = contract.contract_id;
                const buy_price = Number(contract.buy_price) || 0;
                const sell_price = Number(contract.sell_price) || Number(contract.bid_price) || 0;
                const profit = sell_price - buy_price;
                const is_win = profit >= 0;

                setTradeHistory(prev => {
                    // Avoid duplicate entries
                    if (prev.some(t => t.contract_id === contract_id)) return prev;
                    return [
                        ...prev,
                        {
                            id: contract_id,
                            symbol: contract.underlying || '',
                            contract_type: contract.contract_type || '',
                            stake: buy_price,
                            result: is_win ? 'win' : 'loss',
                            profit,
                            buy_price,
                            sell_price,
                            contract_id,
                            timestamp: new Date(),
                        },
                    ];
                });

                setTotalProfit(prev => prev + profit);

                if (is_win) {
                    setLossStreak(0);
                } else {
                    setLossStreak(prev => prev + 1);
                }

                setActiveTradeCount(prev => Math.max(0, prev - 1));

                // Remove from active contracts
                if (engineRef.current) {
                    engineRef.current.active_contracts.delete(contract_id);
                }
            }
        };

        window.addEventListener('automated_contract_update', handleContractUpdate);
        return () => window.removeEventListener('automated_contract_update', handleContractUpdate);
    }, []);

    // Calculate next stake based on martingale strategy
    const calculateNextStake = (prev_stake: number, is_win: boolean): number => {
        const s = stateRef.current;
        switch (s.martingale_strategy) {
            case 'martingale':
                return is_win ? s.stake : prev_stake * s.martingale_size;
            case 'dalembert':
                return is_win
                    ? Math.max(s.stake, prev_stake - s.stake)
                    : prev_stake + s.stake;
            case 'oscars_grind':
                return is_win ? prev_stake + s.stake : prev_stake;
            case 'reverse_martingale':
                return is_win ? prev_stake * s.martingale_size : s.stake;
            default:
                return s.stake;
        }
    };

    // The main trade loop — runs every interval and places trades on random selected markets
    const runTradeLoop = React.useCallback(() => {
        if (!engineRef.current || !engineRef.current.is_running) return;
        const s = stateRef.current;

        // Check profit/loss limits
        if (s.total_profit >= s.take_profit) {
            botNotification(localize('Take profit reached — stopping bot'), undefined, { type: 'success' });
            stopBot();
            return;
        }
        if (s.total_profit <= -s.stop_loss) {
            botNotification(localize('Stop loss reached — stopping bot'), undefined, { type: 'error' });
            stopBot();
            return;
        }

        // Pick a random selected market
        const selected = market_statuses.filter(m => m.selected);
        if (selected.length === 0) return;

        // Limit concurrent open contracts to 1 per market at most
        if (s.current_stake <= 0) return;

        const random_market = selected[Math.floor(Math.random() * selected.length)];
        // Pick randomly between the two contract types in the selected trade type
        const contract_type = trade_type;

        engineRef.current
            .executeTrade(
                random_market.symbol,
                contract_type,
                s.current_stake,
                client?.currency || 'USD',
                s.duration,
                s.duration_unit
            )
            .then(result => {
                if (result) {
                    setActiveTradeCount(prev => prev + 1);
                }
            })
            .catch(err => {
                console.error('Trade execution failed:', err);
            });
    }, [market_statuses, trade_type, client?.currency]);

    // Start automated trading
    const startBot = () => {
        if (!api_base?.api || api_base.api.connection?.readyState !== WebSocket.OPEN) {
            botNotification(localize('Not connected to Deriv API. Please log in first.'), undefined, { type: 'error' });
            return;
        }

        const selected = market_statuses.filter(m => m.selected);
        if (selected.length === 0) {
            botNotification(localize('Please select at least one market'), undefined, { type: 'warning' });
            return;
        }

        // Initialize engine
        const engine = new AutomatedTradeEngine(api_base.api);
        engine.start();
        engineRef.current = engine;

        setIsRunning(true);
        setCurrentStake(stake);
        setLossStreak(0);
        setTotalProfit(0);
        setTradeHistory([]);
        setActiveTradeCount(0);

        stateRef.current.current_stake = stake;
        stateRef.current.total_profit = 0;
        stateRef.current.loss_streak = 0;
        stateRef.current.is_running = true;

        botNotification(localize('Automated bot started — placing trades'), undefined, { type: 'success' });

        // Start trade loop — trade every 3 seconds
        trade_loop_ref.current = setInterval(() => {
            runTradeLoop();
        }, 3000);
    };

    // Stop automated trading
    const stopBot = () => {
        if (engineRef.current) {
            engineRef.current.stop();
            engineRef.current = null;
        }
        if (trade_loop_ref.current) {
            clearInterval(trade_loop_ref.current);
            trade_loop_ref.current = null;
        }
        stateRef.current.is_running = false;
        setIsRunning(false);
        setActiveTradeCount(0);
        botNotification(localize('Automated bot stopped'), undefined, { type: 'info' });
    };

    // Update current_stake when a trade settles (after loss/win recalculation)
    React.useEffect(() => {
        if (!is_running) return;
        const latest = trade_history[trade_history.length - 1];
        if (!latest) return;
        const next = calculateNextStake(stateRef.current.current_stake, latest.result === 'win');
        setCurrentStake(next);
        stateRef.current.current_stake = next;
    }, [trade_history.length, is_running]);

    // Cleanup on unmount
    React.useEffect(() => {
        return () => {
            engineRef.current?.stop();
            if (trade_loop_ref.current) clearInterval(trade_loop_ref.current);
        };
    }, []);

    const toggleMarket = (symbol: string) => {
        setMarketStatuses(prev =>
            prev.map(m => (m.symbol === symbol ? { ...m, selected: !m.selected } : m))
        );
    };

    const selectAll = () => setMarketStatuses(prev => prev.map(m => ({ ...m, selected: true })));
    const deselectAll = () => setMarketStatuses(prev => prev.map(m => ({ ...m, selected: false })));

    const selected_count = market_statuses.filter(m => m.selected).length;
    const wins = trade_history.filter(t => t.result === 'win').length;
    const losses = trade_history.filter(t => t.result === 'loss').length;
    const win_rate = trade_history.length > 0 ? ((wins / trade_history.length) * 100).toFixed(1) : '0.0';

    return (
        <div className='automated'>
            <div className='automated__header'>
                <div className='automated__header__title'>
                    <svg width='24' height='24' viewBox='0 0 24 24' fill='none' xmlns='http://www.w3.org/2000/svg'>
                        <path d='M12 2L2 7L12 12L22 7L12 2Z' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                        <path d='M2 17L12 22L22 17' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                        <path d='M2 12L12 17L22 12' stroke='currentColor' strokeWidth='2' strokeLinecap='round' strokeLinejoin='round'/>
                    </svg>
                    <h1>{localize('Automated Trading Bot')}</h1>
                </div>
                <div className='automated__header__status'>
                    {!is_connected && (
                        <span className='automated__status--disconnected'>
                            {localize('Disconnected')}
                        </span>
                    )}
                    {is_connected && is_running && (
                        <span className='automated__status--running'>
                            <span className='automated__status__dot' />
                            {localize('Running')}
                        </span>
                    )}
                    {is_connected && !is_running && (
                        <span className='automated__status--stopped'>
                            {localize('Stopped')}
                        </span>
                    )}
                </div>
            </div>

            <div className='automated__content'>
                {/* Left Panel — Controls */}
                <div className='automated__controls'>
                    {/* Trade Parameters */}
                    <div className='automated__section'>
                        <h3 className='automated__section__title'>{localize('Trade Parameters')}</h3>

                        <div className='automated__field'>
                            <label className='automated__field__label'>{localize('Contract Type')}</label>
                            <select
                                className='automated__field__select'
                                value={trade_type}
                                onChange={e => setTradeType(e.target.value)}
                                disabled={is_running}
                            >
                                {TRADE_TYPE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>{localize(opt.text)}</option>
                                ))}
                            </select>
                        </div>

                        <div className='automated__field'>
                            <label className='automated__field__label'>{localize('Duration')}</label>
                            <div className='automated__field__row'>
                                <input
                                    type='number'
                                    className='automated__field__input'
                                    value={duration}
                                    onChange={e => setDuration(Number(e.target.value))}
                                    min='1'
                                    disabled={is_running}
                                />
                                <select
                                    className='automated__field__select automated__field__select--small'
                                    value={duration_unit}
                                    onChange={e => setDurationUnit(e.target.value)}
                                    disabled={is_running}
                                >
                                    <option value='t'>{localize('Ticks')}</option>
                                    <option value='s'>{localize('Seconds')}</option>
                                    <option value='m'>{localize('Minutes')}</option>
                                    <option value='h'>{localize('Hours')}</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Stake & Money Management */}
                    <div className='automated__section'>
                        <h3 className='automated__section__title'>{localize('Stake & Money Management')}</h3>

                        <div className='automated__field'>
                            <label className='automated__field__label'>{localize('Initial Stake')}</label>
                            <input
                                type='number'
                                className='automated__field__input'
                                value={stake}
                                onChange={e => setStake(Number(e.target.value))}
                                min='0.35'
                                step='0.01'
                                disabled={is_running}
                            />
                            <span className='automated__field__unit'>{client?.currency || 'USD'}</span>
                        </div>

                        <div className='automated__field'>
                            <label className='automated__field__label'>{localize('Martingale Strategy')}</label>
                            <select
                                className='automated__field__select'
                                value={martingale_strategy}
                                onChange={e => setMartingaleStrategy(e.target.value as MartingaleStrategy)}
                                disabled={is_running}
                            >
                                <option value='martingale'>{localize('Martingale')}</option>
                                <option value='dalembert'>{localize("D'Alembert")}</option>
                                <option value='oscars_grind'>{localize("Oscar's Grind")}</option>
                                <option value='reverse_martingale'>{localize('Reverse Martingale')}</option>
                            </select>
                        </div>

                        {martingale_strategy !== 'oscars_grind' && (
                            <div className='automated__field'>
                                <label className='automated__field__label'>
                                    {martingale_strategy === 'martingale' || martingale_strategy === 'reverse_martingale'
                                        ? localize('Multiplier')
                                        : localize('Unit')}
                                </label>
                                <input
                                    type='number'
                                    className='automated__field__input'
                                    value={martingale_size}
                                    onChange={e => setMartingaleSize(Number(e.target.value))}
                                    min='1.1'
                                    step='0.1'
                                    disabled={is_running}
                                />
                            </div>
                        )}
                    </div>

                    {/* Profit & Loss */}
                    <div className='automated__section'>
                        <h3 className='automated__section__title'>{localize('Profit & Loss Limits')}</h3>

                        <div className='automated__field'>
                            <label className='automated__field__label'>{localize('Take Profit')}</label>
                            <input
                                type='number'
                                className='automated__field__input'
                                value={take_profit}
                                onChange={e => setTakeProfit(Number(e.target.value))}
                                min='1'
                                disabled={is_running}
                            />
                            <span className='automated__field__unit'>{client?.currency || 'USD'}</span>
                        </div>

                        <div className='automated__field'>
                            <label className='automated__field__label'>{localize('Stop Loss')}</label>
                            <input
                                type='number'
                                className='automated__field__input'
                                value={stop_loss}
                                onChange={e => setStopLoss(Number(e.target.value))}
                                min='1'
                                disabled={is_running}
                            />
                            <span className='automated__field__unit'>{client?.currency || 'USD'}</span>
                        </div>
                    </div>

                    {/* Start / Stop */}
                    <div className='automated__actions'>
                        {!is_running ? (
                            <button className='automated__btn automated__btn--start' onClick={startBot}>
                                {localize('Start Bot')}
                            </button>
                        ) : (
                            <button className='automated__btn automated__btn--stop' onClick={stopBot}>
                                {localize('Stop Bot')}
                            </button>
                        )}
                    </div>
                </div>

                {/* Right Panel — Markets & Stats */}
                <div className='automated__markets'>
                    {/* Markets */}
                    <div className='automated__section'>
                        <div className='automated__section__header'>
                            <h3 className='automated__section__title'>
                                {localize('Volatility Indices')}
                                <span className='automated__section__count'>
                                    {selected_count}/{VOLATILITY_INDICES.length}
                                </span>
                            </h3>
                            <div className='automated__section__actions'>
                                <button className='automated__link-btn' onClick={selectAll}>{localize('Select All')}</button>
                                <button className='automated__link-btn' onClick={deselectAll}>{localize('Deselect All')}</button>
                            </div>
                        </div>

                        <div className='automated__market-grid'>
                            {market_statuses.map(market => (
                                <div
                                    key={market.symbol}
                                    className={`automated__market-card ${market.selected ? 'automated__market-card--selected' : ''}`}
                                    onClick={() => toggleMarket(market.symbol)}
                                >
                                    <div className='automated__market-card__header'>
                                        <span className='automated__market-card__name'>{market.name}</span>
                                        <span className={`automated__market-card__status ${is_running && market.selected ? 'automated__market-card__status--active' : ''}`}>
                                            {is_running && market.selected ? '●' : '○'}
                                        </span>
                                    </div>
                                    <div className='automated__market-card__symbol'>{market.symbol}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Last Digit Analysis */}
                    <div className='automated__section automated__section--analysis'>
                        <h3 className='automated__section__title'>
                            {localize('Last Digit Analysis')}
                            {is_connected && (
                                <span className='automated__section__live'>● {localize('Live')}</span>
                            )}
                        </h3>
                        <div className='automated__analysis-grid'>
                            {market_statuses
                                .filter(m => m.selected && market_digit_stats[m.symbol])
                                .map(m => {
                                    const stats = market_digit_stats[m.symbol];
                                    if (!stats || stats.total_ticks === 0) {
                                        return (
                                            <div key={m.symbol} className='automated__analysis-card'>
                                                <div className='automated__analysis-card__header'>
                                                    <span className='automated__analysis-card__symbol'>{m.symbol}</span>
                                                    <span className='automated__analysis-card__count'>0 {localize('ticks')}</span>
                                                </div>
                                                <div className='automated__analysis-card__loading'>
                                                    {localize('Waiting for ticks...')}
                                                </div>
                                            </div>
                                        );
                                    }

                                    const max_count = Math.max(...stats.distribution, 1);
                                    // Find hot (most frequent) and cold (least frequent) digits
                                    const digit_counts = stats.distribution.map((count, digit) => ({ digit, count }));
                                    const sorted = [...digit_counts].sort((a, b) => b.count - a.count);
                                    const hot_digit = sorted[0];
                                    const cold_digit = sorted[sorted.length - 1];

                                    // Count even vs odd
                                    const even_count = stats.distribution[0] + stats.distribution[2] + stats.distribution[4] + stats.distribution[6] + stats.distribution[8];
                                    const odd_count = stats.distribution[1] + stats.distribution[3] + stats.distribution[5] + stats.distribution[7] + stats.distribution[9];

                                    return (
                                        <div key={m.symbol} className='automated__analysis-card'>
                                            <div className='automated__analysis-card__header'>
                                                <span className='automated__analysis-card__symbol'>{m.symbol}</span>
                                                <span className='automated__analysis-card__count'>{stats.total_ticks} {localize('ticks')}</span>
                                            </div>

                                            {/* Distribution bars */}
                                            <div className='automated__analysis-card__bars'>
                                                {stats.distribution.map((count, digit) => (
                                                    <div key={digit} className='automated__digit-bar'>
                                                        <div className='automated__digit-bar__label'>{digit}</div>
                                                        <div className='automated__digit-bar__track'>
                                                            <div
                                                                className={`automated__digit-bar__fill ${digit === hot_digit.digit && hot_digit.count > 0 ? 'automated__digit-bar__fill--hot' : ''} ${digit === cold_digit.digit && cold_digit.count > 0 ? 'automated__digit-bar__fill--cold' : ''}`}
                                                                style={{ width: `${(count / max_count) * 100}%` }}
                                                            />
                                                        </div>
                                                        <div className='automated__digit-bar__count'>{count}</div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Summary */}
                                            <div className='automated__analysis-card__summary'>
                                                <div className='automated__analysis-card__summary-item'>
                                                    <span className='automated__analysis-card__summary-label'>{localize('Hot')}</span>
                                                    <span className='automated__analysis-card__summary-value automated__analysis-card__summary-value--hot'>{hot_digit.digit}</span>
                                                </div>
                                                <div className='automated__analysis-card__summary-item'>
                                                    <span className='automated__analysis-card__summary-label'>{localize('Cold')}</span>
                                                    <span className='automated__analysis-card__summary-value automated__analysis-card__summary-value--cold'>{cold_digit.digit}</span>
                                                </div>
                                                <div className='automated__analysis-card__summary-item'>
                                                    <span className='automated__analysis-card__summary-label'>{localize('Even')}</span>
                                                    <span className='automated__analysis-card__summary-value'>{even_count}</span>
                                                </div>
                                                <div className='automated__analysis-card__summary-item'>
                                                    <span className='automated__analysis-card__summary-label'>{localize('Odd')}</span>
                                                    <span className='automated__analysis-card__summary-value'>{odd_count}</span>
                                                </div>
                                            </div>

                                            {/* Recent digits strip */}
                                            <div className='automated__analysis-card__recent'>
                                                {stats.recent_digits.slice(0, 20).map((t, i) => (
                                                    <span key={i} className={`automated__recent-digit automated__recent-digit--${t.digit % 2 === 0 ? 'even' : 'odd'}`}>
                                                        {t.digit}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>
                    </div>

                    {/* Live Stats */}
                    <div className='automated__section automated__section--stats'>
                        <h3 className='automated__section__title'>{localize('Trading Statistics')}</h3>
                        <div className='automated__stats-grid'>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Total Profit')}</span>
                                <span className={`automated__stat__value ${total_profit >= 0 ? 'automated__stat__value--positive' : 'automated__stat__value--negative'}`}>
                                    {total_profit >= 0 ? '+' : ''}{total_profit.toFixed(2)}
                                </span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Current Stake')}</span>
                                <span className='automated__stat__value'>{current_stake.toFixed(2)}</span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Win Rate')}</span>
                                <span className='automated__stat__value'>{win_rate}%</span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Open Trades')}</span>
                                <span className='automated__stat__value'>{active_trade_count}</span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Wins')}</span>
                                <span className='automated__stat__value automated__stat__value--positive'>{wins}</span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Losses')}</span>
                                <span className='automated__stat__value automated__stat__value--negative'>{losses}</span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Loss Streak')}</span>
                                <span className='automated__stat__value'>{loss_streak}</span>
                            </div>
                            <div className='automated__stat'>
                                <span className='automated__stat__label'>{localize('Total Trades')}</span>
                                <span className='automated__stat__value'>{trade_history.length}</span>
                            </div>
                        </div>
                    </div>

                    {/* Trade History */}
                    {trade_history.length > 0 && (
                        <div className='automated__section automated__section--history'>
                            <h3 className='automated__section__title'>{localize('Recent Trades')}</h3>
                            <div className='automated__trade-list'>
                                {trade_history.slice(-15).reverse().map(trade => (
                                    <div key={trade.contract_id} className={`automated__trade-item automated__trade-item--${trade.result}`}>
                                        <div className='automated__trade-item__info'>
                                            <span className='automated__trade-item__symbol'>{trade.symbol}</span>
                                            <span className='automated__trade-item__type'>
                                                {trade.contract_type} · {trade.stake.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className='automated__trade-item__amount'>
                                            <span className={`automated__trade-item__profit automated__trade-item__profit--${trade.result}`}>
                                                {trade.profit >= 0 ? '+' : ''}{trade.profit.toFixed(2)}
                                            </span>
                                            <span className='automated__trade-item__time'>
                                                {trade.timestamp.toLocaleTimeString()}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
});

export default Automated;

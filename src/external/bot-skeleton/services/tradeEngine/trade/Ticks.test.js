import { BOT_SPEED } from '@/constants/bot-speed';
import Ticks from './Ticks';

describe('ultra-fast tick processing', () => {
    const createTicksEngine = () => {
        const Engine = Ticks(class {});
        const scope = {
            ticksService: {
                pipSizes: { R_100: 2 },
            },
        };
        const engine = new Engine(scope);

        engine.$scope = scope;
        engine.symbol = 'R_100';
        engine.setSpeedMode(BOT_SPEED.ULTRA_FAST);
        return engine;
    };

    it('consumes queued ticks in order without skipping epochs', async () => {
        const engine = createTicksEngine();
        const ticks = [
            { epoch: 1, quote: 100.01 },
            { epoch: 2, quote: 100.02 },
            { epoch: 3, quote: 100.03 },
        ];

        ticks.forEach(tick => engine.enqueueTick(tick));

        await expect(engine.getNextTick(true)).resolves.toEqual(ticks[0]);
        await expect(engine.getNextTick(true)).resolves.toEqual(ticks[1]);
        await expect(engine.getNextTick(true)).resolves.toEqual(ticks[2]);
    });

    it('reads the digit from the currently processed ultra-fast tick', async () => {
        const engine = createTicksEngine();
        const tick = { epoch: 1, quote: 100.07 };

        engine.enqueueTick(tick);
        await engine.getNextTick(true);

        await expect(engine.getLastDigit()).resolves.toBe(7);
    });
});

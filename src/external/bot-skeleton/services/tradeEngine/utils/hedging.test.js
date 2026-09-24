import { getHedgingPurchaseStatements } from './hedging';

describe('hedging purchase logic', () => {
    it('keeps the higher and lower offsets independent for real hedge trades', () => {
        const result = getHedgingPurchaseStatements({ higherOffset: 3, lowerOffset: -2 });

        expect(result.higherOffset).toBe(3);
        expect(result.lowerOffset).toBe(-2);
        expect(result.callBarrier).toBe(3);
        expect(result.putBarrier).toBe(-2);
        expect(result.code).toBe("Bot.purchase('CALL', 3);\nBot.purchase('PUT', -2);\n");
    });

    it('falls back safely when values are missing or invalid', () => {
        const result = getHedgingPurchaseStatements({ higherOffset: null, lowerOffset: undefined });

        expect(result.higherOffset).toBe(1);
        expect(result.lowerOffset).toBe(-1);
        expect(result.callBarrier).toBe(1);
        expect(result.putBarrier).toBe(-1);
    });

    it('rejects zero-value barriers before a live buy request is sent', () => {
        const result = getHedgingPurchaseStatements({ higherOffset: 0, lowerOffset: 0 });

        expect(result.higherOffset).toBe(1);
        expect(result.lowerOffset).toBe(-1);
        expect(result.callBarrier).toBe(1);
        expect(result.putBarrier).toBe(-1);
    });
});

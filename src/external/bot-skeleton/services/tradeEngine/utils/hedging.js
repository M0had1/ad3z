export const normalizeHedgingOffset = (offset, fallback = 1) => {
    const value = Number(offset);

    if (!Number.isFinite(value)) {
        return Number(fallback);
    }

    return Math.abs(value) || Number(fallback);
};

export const getHedgingPurchaseStatements = ({ higherOffset, lowerOffset, fallbackHigher = 1, fallbackLower = 1 } = {}) => {
    const higher = normalizeHedgingOffset(higherOffset, fallbackHigher);
    const lower = normalizeHedgingOffset(lowerOffset, fallbackLower);
    const callBarrier = higher;
    const putBarrier = -lower;

    return {
        higherOffset: higher,
        lowerOffset: lower,
        callBarrier,
        putBarrier,
        code: `Bot.purchase('CALL', ${callBarrier});\nBot.purchase('PUT', ${putBarrier});\n`,
    };
};

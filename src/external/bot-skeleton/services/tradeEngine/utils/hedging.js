export const normalizeHedgingOffset = (offset, fallback = 1, sign = 1) => {
    const value = Number(offset);
    const fallbackValue = Math.abs(Number(fallback)) || 1;

    if (!Number.isFinite(value)) {
        return sign * fallbackValue;
    }

    return sign * (Math.abs(value) || fallbackValue);
};

export const getHedgingPurchaseStatements = ({ higherOffset, lowerOffset, fallbackHigher = 1, fallbackLower = 1 } = {}) => {
    const higher = normalizeHedgingOffset(higherOffset, fallbackHigher, 1);
    const lower = normalizeHedgingOffset(lowerOffset, fallbackLower, -1);
    const callBarrier = `+${higher}`;
    const putBarrier = `${lower}`;

    return {
        higherOffset: higher,
        lowerOffset: lower,
        callBarrier,
        putBarrier,
        code: `Bot.purchase('CALL', '${callBarrier}');\nBot.purchase('PUT', '${putBarrier}');\n`,
    };
};

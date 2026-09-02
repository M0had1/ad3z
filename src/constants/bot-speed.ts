export const BOT_SPEED = Object.freeze({
    NORMAL: 'normal',
    FAST: 'fast',
    ULTRA_FAST: 'ultra_fast',
});

export type TBotSpeed = (typeof BOT_SPEED)[keyof typeof BOT_SPEED];

export const BOT_SPEED_OPTIONS = [
    { value: BOT_SPEED.NORMAL, label: 'Normal' },
    { value: BOT_SPEED.FAST, label: 'Fast' },
    { value: BOT_SPEED.ULTRA_FAST, label: 'Ultra fast' },
] as const;

export const BOT_SPEED_WAIT_SECONDS: Record<TBotSpeed, number> = {
    [BOT_SPEED.NORMAL]: 1,
    [BOT_SPEED.FAST]: 0.2,
    [BOT_SPEED.ULTRA_FAST]: 0.05,
};
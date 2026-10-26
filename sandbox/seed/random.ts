export type Random = () => number;

// mulberry32: a small seeded generator, so the same seed picks the same runs
export function seeded(seed: number): Random {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// One item, more likely the higher its weight
export function pick<T extends { weight: number }>(random: Random, items: readonly T[]): T {
    const roll = random() * items.reduce((total, item) => total + item.weight, 0);
    let sum = 0;
    return items.find((item) => (sum += item.weight) > roll) ?? (items.at(-1) as T);
}

// A whole number from min to max, both included
export function between(random: Random, min: number, max: number): number {
    return min + Math.floor(random() * (max - min + 1));
}

export function oneOf<T>(random: Random, items: readonly T[]): T {
    return items[between(random, 0, items.length - 1)] as T;
}

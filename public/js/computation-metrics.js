// Logical operations in this JS runtime, not CPU instructions or FLOPS.
const counters = Object.create(null);
export function countComputation(name, amount = 1) { counters[name] = (counters[name] || 0) + amount; }
export function computationSnapshot() { return { ...counters }; }

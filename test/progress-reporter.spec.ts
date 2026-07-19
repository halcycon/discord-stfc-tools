import { describe, expect, it, vi } from 'vitest';
import { createProgressReporter } from '../src/progress-reporter';

describe('createProgressReporter', () => {
	it('does not block report() on slow onProgress', async () => {
		let resolveEdit!: () => void;
		const gate = new Promise<void>((r) => {
			resolveEdit = r;
		});
		let calls = 0;
		const onProgress = vi.fn(async () => {
			calls++;
			if (calls === 1) await gate;
		});

		const progress = createProgressReporter(onProgress, { minIntervalMs: 0 });
		const t0 = Date.now();
		progress.report('one');
		progress.report('two');
		progress.report('three');
		expect(Date.now() - t0).toBeLessThan(50);

		resolveEdit();
		await progress.flush();
		expect(onProgress).toHaveBeenCalled();
		const last = onProgress.mock.calls.at(-1)?.[0];
		expect(last).toBe('three');
	});
});
